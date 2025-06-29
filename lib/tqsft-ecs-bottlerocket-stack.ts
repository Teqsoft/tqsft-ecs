import { CfnParameter, Fn, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { AutoScalingGroup } from "aws-cdk-lib/aws-autoscaling";
import { InstanceClass, InstanceSize, InstanceType, LaunchTemplate, MachineImage, OperatingSystemType, Peer, Port, SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2";
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

    /**
     *  BOTTLEROCKET ASG
     */

    const bottlerocketSG = new SecurityGroup(this, "BottlerocketSG", {
      vpc: vpc,
      securityGroupName: "BottlerocketSG",
      allowAllOutbound: true,
      allowAllIpv6Outbound: true
    });

    bottlerocketSG.addIngressRule(
      Peer.ipv4(vpcCidr), 
      Port.allTraffic(), 
      "Ingress All Trafic in the subnet"
    )

    const bottlerocketLaunchTemplate = new LaunchTemplate(this, "BRLaunchTemplate", {
      // requireImdsv2: true,
      role: instanceRole,
      instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.MICRO),
      machineImage: MachineImage.fromSsmParameter(
        "/aws/service/bottlerocket/aws-ecs-1/arm64/latest/image_id", {
          os: OperatingSystemType.UNKNOWN,
        }
      ),
      launchTemplateName: "BottleRocketLaunchTemplate",
      securityGroup: bottlerocketSG
    });

    const bottlerocketASG = new AutoScalingGroup(this, 'BottlerocketASG' , {
      vpc: vpc,
      launchTemplate: bottlerocketLaunchTemplate,
      minCapacity: 0,
      maxCapacity: 1,
      autoScalingGroupName: 'BottlerocketASG'
    })

    const capacityProviderBottlerocket = new AsgCapacityProvider(this, 'BottlerocketCapProvider', {
      autoScalingGroup: bottlerocketASG,
      machineImageType: MachineImageType.BOTTLEROCKET,
      enableManagedTerminationProtection: false,
      capacityProviderName: "BottlerocketAsgCapProvider"
    });

    // ecsCluster.addAsgCapacityProvider(capacityProviderBottlerocket, {
    //   machineImageType: MachineImageType.BOTTLEROCKET
    // })

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

  }
}