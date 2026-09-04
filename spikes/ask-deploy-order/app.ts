import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';

/**
 * S6 stack: hello-world Lambda with the Alexa Skills Kit trigger permission.
 * SKILL_ID set: permission carries eventSourceToken. Unset: open permission plus a warning.
 */
const skillId = process.env.SKILL_ID;

const app = new cdk.App();
const stack = new cdk.Stack(app, 'AlexaMcpBridgeAskProbe', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
});

const fn = new lambda.Function(stack, 'Hello', {
  runtime: lambda.Runtime.NODEJS_22_X,
  architecture: lambda.Architecture.ARM_64,
  handler: 'index.handler',
  timeout: cdk.Duration.seconds(8),
  code: lambda.Code.fromInline(`
    exports.handler = async (event) => ({
      version: '1.0',
      response: {
        outputSpeech: { type: 'PlainText', text: 'Hello from the probe. Request type ' + (event.request && event.request.type) },
        shouldEndSession: true,
      },
    });
  `),
});

fn.addPermission('AlexaSkillsKit', {
  principal: new cdk.aws_iam.ServicePrincipal('alexa-appkit.amazon.com'),
  action: 'lambda:InvokeFunction',
  ...(skillId ? { eventSourceToken: skillId } : {}),
});
if (!skillId) {
  cdk.Annotations.of(fn).addWarning(
    'SKILL_ID unset: the Alexa trigger permission is open to any skill.',
  );
}

new cdk.CfnOutput(stack, 'LambdaArn', { value: fn.functionArn });
