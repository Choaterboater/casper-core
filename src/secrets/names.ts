import path from "node:path";

/** File names whose values are secrets by default: dotenv, INI, credential and key files. */
const SECRET_FILE_NAME = /^(?:\.env(?:\..*)?|.*\.env|\.envrc|\.netrc|_netrc|\.pgpass|pgpass\.conf|\.npmrc|\.yarnrc(?:\.yml)?|\.pypirc|\.git-credentials|\.dockercfg|\.s3cfg|\.boto|credentials(?:\..*)?|.*[._-]credentials(?:\..*)?|secrets?(?:\..*)?|\.secrets?(?:\..*)?|.*\.(?:ini|properties|tfvars|tfstate|tfstate\.backup|pem|key|ovpn)|id_(?:rsa|dsa|ecdsa|ed25519)|vault[._-]?pass(?:word)?(?:\..*)?)$/i;

/** True for .env, .env.local, prod.env, .envrc, .netrc, credentials, *.ini, *.tfvars, *.pem, id_rsa ... */
export function isSecretFile(filePath: string): boolean {
  const normal = filePath.replaceAll("\\", "/");
  // Docker's login file: ~/.docker/config.json, or a DOCKER_CONFIG folder named docker.
  return SECRET_FILE_NAME.test(path.posix.basename(normal)) || /(?:^|\/)\.?docker\/config\.json$/i.test(normal);
}

/** Key files (*.pem, *.key, *.p8, id_rsa, id_ed25519_deploy ...): a run of long base64 lines in them is a key's body, even with no BEGIN line. */
export function isKeyFile(filePath: string): boolean {
  return /(?:\.(?:pem|key|p8)|^id_(?:rsa|dsa|ecdsa|ed25519)(?:[_-][^.]*)?)$/i.test(path.posix.basename(filePath.replaceAll("\\", "/")));
}

/** PostgreSQL's password file (host:port:database:user:password per line). */
export function isPgpassFile(filePath: string): boolean {
  return /^(?:\.pgpass|pgpass\.conf)$/i.test(path.posix.basename(filePath.replaceAll("\\", "/")));
}
