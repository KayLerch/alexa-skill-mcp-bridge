/**
 * IAM resources for bedrock:InvokeModel*. A cross-region inference profile such as
 * us.amazon.nova-2-lite-v1:0 needs the profile ARN in the stack's region plus the underlying
 * foundation model in every region the profile routes to (hence the wildcard region).
 */
const PROFILE_PREFIX = /^(us|eu|apac|global|jp|au|ca|sa|us-gov)\./;

export function modelResourceArns(modelIds: string[], region: string, account: string): string[] {
  const arns = new Set<string>();
  for (const modelId of modelIds) {
    if (PROFILE_PREFIX.test(modelId)) {
      arns.add(`arn:aws:bedrock:${region}:${account}:inference-profile/${modelId}`);
      arns.add(`arn:aws:bedrock:*::foundation-model/${modelId.replace(PROFILE_PREFIX, '')}`);
    } else {
      arns.add(`arn:aws:bedrock:${region}::foundation-model/${modelId}`);
    }
  }
  return [...arns];
}
