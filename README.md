# tqsft-ecs

This is a blank project for CDK development with TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

* `npm run build`                                       compile typescript to js
* `npm run watch`                                       watch for changes and compile
* `npm run test`                                        perform the jest unit tests
* `cdk deploy --parameter KEY_PAIR_NAME=${AWS_KEY_PAIR_NAME}`         deploy this stack to your default AWS account/region
* `cdk diff --parameter KEY_PAIR_NAME=${AWS_KEY_PAIR_NAME}`           compare deployed stack with current state
* `cdk synth --parameter KEY_PAIR_NAME=${AWS_KEY_PAIR_NAME}`          emits the synthesized CloudFormation template
