import { CfnParameter, Fn, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { AutoScalingGroup } from "aws-cdk-lib/aws-autoscaling";
import { InstanceClass, InstanceSize, InstanceType, KeyPair, LaunchTemplate, MachineImage, OperatingSystemType, Peer, Port, SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2";
import { AsgCapacityProvider, MachineImageType } from "aws-cdk-lib/aws-ecs";
import { ManagedPolicy, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

export class TqsftEcsBottlerocketStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const vpcCidr = Fn.importValue('Tqsft-VpcCidr');
    const keyPairName = new CfnParameter(this, "KeyPairName", {
        type: "String",
        description: "Key Pair Name for SSH Access",
    });

    const dnsNs = new CfnParameter(this, "PrivateDnsNS", {
        type: "String",
        description: "Private Domain Namespace for "
    })

    // Getting VPC Id from SSM Parameter Store for lookup 
    const vpcId = StringParameter.valueFromLookup(this, 'TqsftStack-VpcId');
    const clusterName = 'TqsftCluster';

    const vpc = Vpc.fromLookup(this, "vpc", {
        vpcId: vpcId
    });

    // Logs for Cluster 
    const nginxLogGroup = new LogGroup(this, 'TqsftEcsLogGroup', {
        logGroupName: '/ecs/tqsft-services',
        removalPolicy: RemovalPolicy.DESTROY,
        retention: RetentionDays.ONE_MONTH
    })

    // Instance Role for the ASG Instances
    const instanceRole = new Role(this, 'MyRole', {
        assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
        roleName: "Ec2ClusterInstanceProfile"
    });
    instanceRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));
    
    const keyPair = KeyPair.fromKeyPairName(this, "KeyPair", keyPairName.valueAsString);
    
    const al2023x68SG = new SecurityGroup(this, "AL2023x68SG", {
      vpc: vpc,
      securityGroupName: "AL2023X64SG",
      allowAllOutbound: true,
      allowAllIpv6Outbound: true
    });

    al2023x68SG.addIngressRule(
      Peer.ipv4(vpcCidr), 
      Port.allTraffic(), 
      "Ingress All Trafic in the subnet"
    )

    const al2023x68LaunchTemplate = new LaunchTemplate(this, "BRLaunchTemplate", {
      // requireImdsv2: true,
      role: instanceRole,
      instanceType: InstanceType.of(InstanceClass.T3A, InstanceSize.MICRO),
      machineImage: MachineImage.fromSsmParameter(
        "/aws/service/ecs/optimized-ami/amazon-linux-2023/recommended/image_id", {
          os: OperatingSystemType.LINUX,
        }
      ),
      launchTemplateName: "AL2023x64LaunchTemplate",
      keyPair: keyPair,
      securityGroup: al2023x68SG
    });

    const al2023x64ASG = new AutoScalingGroup(this, 'AL2023x64ASG' , {
      vpc: vpc,
      launchTemplate: al2023x68LaunchTemplate,
      minCapacity: 0,
      maxCapacity: 1,
      autoScalingGroupName: 'AL2023x64ASG'
    })

    const capacityProviderAL2023x64 = new AsgCapacityProvider(this, 'AL2023x64CapProvider', {
      autoScalingGroup: al2023x64ASG,
      machineImageType: MachineImageType.AMAZON_LINUX_2,
      enableManagedTerminationProtection: false,
      capacityProviderName: "AL2023x64AsgCapProvider"
    })

    // ecsCluster.addAsgCapacityProvider(capacityProviderAL2023x64, {
    //   machineImageType: MachineImageType.AMAZON_LINUX_2
    // })

  }
}