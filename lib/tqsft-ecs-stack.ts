import * as cdk from 'aws-cdk-lib';
import { AutoScalingGroup } from 'aws-cdk-lib/aws-autoscaling';
import { InstanceClass, InstanceSize, InstanceType, KeyPair, LaunchTemplate, MachineImage, OperatingSystemType, Peer, Port, SecurityGroup, SubnetType, UserData, Vpc } from 'aws-cdk-lib/aws-ec2';
import { AsgCapacityProvider, Cluster, MachineImageType, } from 'aws-cdk-lib/aws-ecs';
import { NetworkLoadBalancer, } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { ManagedPolicy, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { readFileSync } from 'fs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class TqsftEcsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const keyPairName = new cdk.CfnParameter(this, "keyPairName", {
      type: "String",
      description: "Key Pair Name for SSH Access",
    });

    // Getting VPC Id from SSM Parameter Store for lookup 
    const vpcId = StringParameter.valueFromLookup(this, 'TqsftStack-VpcId');
    const clusterName = 'Ec2Cluster';

    const vpc = Vpc.fromLookup(this, "vpc", {
      vpcId: vpcId
    });

    // Creating the ECS Cluster in the VPC
    const ecsCluster = new Cluster(this, clusterName, {
      clusterName,
      vpc: vpc,
    })

    // User Data to load on Servers this is for Amazon-Linux
    const rawData = readFileSync('lib/amazonlinux-user-data.sh', 'utf8');
    const userData = UserData.custom(rawData);

    // Logs for Cluster 
    const nginxLogGroup = new LogGroup(this, 'nginxLogGroup', {
      logGroupName: '/ecs/tqsft-services',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: RetentionDays.ONE_MONTH
    })

    // Instance Role for the ASG Instances
    const instanceRole = new Role(this, 'MyRole', {
      assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
      roleName: "Ec2ClusterInstanceProfile"
    });
    instanceRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));

    /**
     *  AMAZON LINUX 2023 ASG
     */

    const keyPair = KeyPair.fromKeyPairName(this, "KeyPair", keyPairName.valueAsString);

    const launchTemplate = new LaunchTemplate(this, "LaunchTemplate", {
      // requireImdsv2: true,
      role: instanceRole,
      instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.MICRO),
      machineImage: MachineImage.fromSsmParameter(
        "/aws/service/ecs/optimized-ami/amazon-linux-2023/arm64/recommended/image_id", {
          os: OperatingSystemType.LINUX,
          userData: userData
        }
      ),
      keyPair: keyPair,
      launchTemplateName: "AmazonLinuxLaunchTemplate"
    });

    const AmazonLinux2023ASG = new AutoScalingGroup(this, 'AL2023Asg', {
      vpc: vpc,
      launchTemplate: launchTemplate,
      minCapacity: 0,
      maxCapacity: 1
    })

    const capacityProviderBr = new AsgCapacityProvider(this, 'AL2023AsgCapProvider', {
      autoScalingGroup: AmazonLinux2023ASG,
      machineImageType: MachineImageType.AMAZON_LINUX_2,
      enableManagedTerminationProtection: false,
      capacityProviderName: "Ec2ClusterAsgCapProvider"
    })

    /**
     *  BOTTLEROCKET ASG
     */
    const bottlerocketLaunchTemplate = new LaunchTemplate(this, "BRLaunchTemplate", {
      // requireImdsv2: true,
      role: instanceRole,
      instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.MICRO),
      machineImage: MachineImage.fromSsmParameter(
        "/aws/service/bottlerocket/aws-ecs-1/arm64/latest/image_id", {
          os: OperatingSystemType.UNKNOWN,
        }
      ),
      launchTemplateName: "BottleRocketLaunchTemplate"
    });

    const bottlerocketASG = new AutoScalingGroup(this, 'BottlerocketASG' , {
      vpc: vpc,
      launchTemplate: bottlerocketLaunchTemplate,
      minCapacity: 0,
      maxCapacity: 1
    })

    const capacityProviderBottlerocket = new AsgCapacityProvider(this, 'BottlerocketCapProvider', {
      autoScalingGroup: bottlerocketASG,
      machineImageType: MachineImageType.BOTTLEROCKET,
      enableManagedTerminationProtection: false,
      capacityProviderName: "BottlerocketCapProvider"
    })

    ecsCluster.addAsgCapacityProvider(capacityProviderBr, {
      machineImageType: MachineImageType.AMAZON_LINUX_2
    })

    ecsCluster.addAsgCapacityProvider(capacityProviderBottlerocket, {
      machineImageType: MachineImageType.BOTTLEROCKET
    })

    bottlerocketASG.addUserData(
      'allow-privileged-containers = true',
      '',
      '[settings.oci-defaults.capabilities]',
      'sys-admin = true',
      'net-admin = true',
      '',
      '[settings.kernel.sysctl]',
      '"net.ipv4.conf.all.src_valid_mark" = "1"',
      '"net.ipv4.conf.all.proxy_arp" = "1"',
      '"net.ipv4.ip_forward" = "1"'
    );

    /**
     *  Security Group for the Network Load Balancer
     */
    const nlbSg = new SecurityGroup(this, "NlbSecurityGroup", {
      vpc: vpc,
      securityGroupName: "NlbSecurityGroup"
    });

    nlbSg.addIngressRule(
      Peer.anyIpv4(), 
      Port.tcp(80), 
      "Ingress for HTTP"
    )

    nlbSg.addIngressRule(
      Peer.anyIpv4(), 
      Port.tcp(443), 
      "Ingress for HTTPS"
    )

    /**
     *  Main Network Load Balancer
     */
    const nlb = new NetworkLoadBalancer(this, 'nlb', {
      vpc: vpc,
      internetFacing: true,
      loadBalancerName: "TqsftMainNLB",
      vpcSubnets: {
        subnetType: SubnetType.PUBLIC
      },
      securityGroups: [ nlbSg ]
    })

    /**
     *  Outputs 
     */
    new StringParameter(this, 'TqsftStackNLBArn', {
      parameterName: 'TqsftStack-NLBArn',
      stringValue: nlb.loadBalancerArn
    })

    new StringParameter(this, 'TqsftStackNLBSG', {
      parameterName: 'TqsftStack-NLBSG',
      stringValue: nlbSg.securityGroupId
    })

  }
}