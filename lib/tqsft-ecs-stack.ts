import * as cdk from 'aws-cdk-lib';
import { AutoScalingGroup } from 'aws-cdk-lib/aws-autoscaling';
import { BlockDeviceVolume, EbsDeviceVolumeType, InstanceClass, InstanceSize, InstanceType, KeyPair, LaunchTemplate, MachineImage, OperatingSystemType, Peer, Port, SecurityGroup, SubnetType, UserData, Vpc } from 'aws-cdk-lib/aws-ec2';
import { AsgCapacityProvider, Cluster, MachineImageType, } from 'aws-cdk-lib/aws-ecs';
import { NetworkLoadBalancer, } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { ManagedPolicy, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { PrivateDnsNamespace } from 'aws-cdk-lib/aws-servicediscovery';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { readFileSync } from 'fs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class TqsftEcsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpcCidr = cdk.Fn.importValue('Tqsft-VpcCidr');
    const keyPairName = new cdk.CfnParameter(this, "KeyPairName", {
      type: "String",
      description: "Key Pair Name for SSH Access",
    });

    const dnsNs = new cdk.CfnParameter(this, "PrivateDnsNS", {
      type: "String",
      description: "Private Domain Namespace for "
    })

    // Getting VPC Id from SSM Parameter Store for lookup 
    const vpcId = StringParameter.valueFromLookup(this, 'TqsftStack-VpcId');
    const clusterName = 'TqsftCluster';

    const vpc = Vpc.fromLookup(this, "vpc", {
      vpcId: vpcId
    });

    // Creating the ECS Cluster in the VPC
    const ecsCluster = new Cluster(this, clusterName, {
      clusterName,
      vpc: vpc,
    })

    const TqsftDnsNs = new PrivateDnsNamespace(this, "Private-DnsNS", {
      name: dnsNs.valueAsString,
      vpc: vpc,
      description: "Private DnsNS for Teqsoft Services"
    })

    // User Data to load on Servers this is for Amazon-Linux
    const rawData = readFileSync('lib/amazonlinux-user-data.sh', 'utf8');
    const userData = UserData.custom(rawData);

    // Logs for Cluster 
    const nginxLogGroup = new LogGroup(this, 'TqsftEcsLogGroup', {
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

    const amazonLinux2023SG = new SecurityGroup(this, "AmazonLinux2023SG", {
      vpc: vpc,
      securityGroupName: "AmazonLinux2023SG",
      allowAllOutbound: true,
      allowAllIpv6Outbound: true
    });

    amazonLinux2023SG.addIngressRule(
      Peer.ipv4(vpcCidr), 
      Port.allTraffic(), 
      "Ingress All Trafic in the subnet"
    )

    const keyPair = KeyPair.fromKeyPairName(this, "KeyPair", keyPairName.valueAsString);

    const launchTemplate = new LaunchTemplate(this, "LaunchTemplate", {
      // requireImdsv2: true,
      role: instanceRole,
      instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.MICRO),
      // machineImage: MachineImage.fromSsmParameter(
      //   "/aws/service/ecs/optimized-ami/amazon-linux-2023/arm64/recommended/image_id", {
      //     os: OperatingSystemType.LINUX,
      //     // userData: userData
      //   }
      // ),
      machineImage: MachineImage.genericLinux({
        "us-east-1": "ami-0e61e6aebc8334403"
      }),
      keyPair: keyPair,
      launchTemplateName: "AmazonLinuxLaunchTemplate",
      securityGroup: amazonLinux2023SG,
      blockDevices: [
        {
          deviceName: "/dev/xvda",
          volume: BlockDeviceVolume.ebs(12, {
            deleteOnTermination: true,
            encrypted: true,
            volumeType: EbsDeviceVolumeType.GP3
          })
        }
      ]
    });

    const AmazonLinux2023ASG = new AutoScalingGroup(this, 'AL2023Asg', {
      vpc: vpc,
      launchTemplate: launchTemplate,
      minCapacity: 0,
      maxCapacity: 1,
      autoScalingGroupName: 'AmazonLinux2023Asg'
    })

    AmazonLinux2023ASG.addUserData(
      'dnf install wireguard-tools'
    );

    const capacityProviderBr = new AsgCapacityProvider(this, 'AL2023AsgCapProvider', {
      autoScalingGroup: AmazonLinux2023ASG,
      machineImageType: MachineImageType.AMAZON_LINUX_2,
      enableManagedTerminationProtection: false,
      capacityProviderName: "AL2023AsgCapProvider"
    })

    /**
     *  Outputs 
     */
    
    new cdk.CfnOutput(this, 'TqsftClusterName', {
      exportName: 'TqsftStack-ClusterName',
      value: clusterName
    })

    new cdk.CfnOutput(this, 'TqsftNsArn', {
      exportName: 'TqsftStack-NsArn',
      value: TqsftDnsNs.namespaceArn
    })

    new cdk.CfnOutput(this, 'TqsftNsId', {
      exportName: 'TqsftStack-NsId',
      value: TqsftDnsNs.namespaceId
    })

    new cdk.CfnOutput(this, 'TqsftNsName', {
      exportName: 'TqsftStack-NsName',
      value: TqsftDnsNs.namespaceName
    })

  }
}
