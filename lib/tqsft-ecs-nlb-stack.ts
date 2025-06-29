import { CfnOutput, CfnParameter, Fn, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { KeyPair, Peer, Port, SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { NetworkLoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancingv2";
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
    
    new StringParameter(this, 'TqsftNLBArn', {
      parameterName: 'TqsftStack-NLBArn',
      stringValue: nlb.loadBalancerArn
    })

    new StringParameter(this, 'TqsftNLBSG', {
      parameterName: 'TqsftStack-NLBSG',
      stringValue: nlbSg.securityGroupId
    })

    new CfnOutput(this, 'TqsftNLBArnOutput', {
      exportName: 'TqsftStack-NLBArn',
      value: nlb.loadBalancerArn
    })

    new CfnOutput(this, 'TqsftNLBSGOutput', {
      exportName: 'TqsftStack-NLBSG',
      value: nlbSg.securityGroupId
    })
    
  }
}