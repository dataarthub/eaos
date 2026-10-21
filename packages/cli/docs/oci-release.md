---
title: "Configure and verify an OCI release"
description: "Install the CLI and approved deployment packages. Use oci-adb or its alias oci-adb-standard. The host owns actual Oracle/identity credentials, an environment-wide lock, all-instance drain, immutable images and reviewed migration executors. Examples use reserved documentation domains and synthetic..."
sidebar:
  order: 20
archetype: "how-to"
project: "eaos-workspace"
tags: ["eaos", "how-to"]
---

# Configure and verify an OCI release

## Prerequisites

Install the CLI and approved deployment packages. Use `oci-adb` or its alias `oci-adb-standard`. The host owns actual Oracle/identity credentials, an environment-wide lock, all-instance drain, immutable images and reviewed migration executors. Examples use reserved documentation domains and synthetic identifiers.

## Public import

Install the package; the subpath below is an import target, not a separate package. Registry installation requires a published EAOS release; before publication use the owning workspace's checksum-verified build artifact.

```bash
bun add @alneas/eaos-cli
```

```typescript
import { definePlatformOperations } from '@alneas/eaos-cli/platform/operations'

export const defineHostOperations = definePlatformOperations
```

Bun/server tooling only. OCI generation requires the Pulumi/OCI peers declared by the CLI. Defining host operations does not execute a release; credentials and live executors remain host-owned.

## Step-by-Step Implementation

Declare package selection in `eaos.platform.json`:

```json
{
  "preset": "oci-adb",
  "platform": { "appName": "example-platform", "baseDomain": "example.com" },
  "plugins": ["@alneas/eaos-plugins/approval", "@alneas/eaos-plugins/admin"],
  "corporatePackages": [
    { "id": "example-extension", "path": "./vendor/example-extension", "tenants": ["example-tenant"] }
  ]
}
```

Install `@alneas/eaos-plugins` once to acquire the standard collection; the `/approval`, `/field-customization` and `/admin` selectors identify modules, not separately installable packages. Before publication, install its exact checksum-verified archive instead of assuming the registry release exists. List only the modules this host needs.

Each selected module exports its own `./<id>/deployment.json` with asset SHA-256, runtime, lifecycle bundle, components and tasks. A third-party single-plugin package may still export `./deployment.json` and use its package name directly as the selector. Collection inventories use distinct logical owners such as `@alneas/eaos-plugins/approval`, while lifecycle plugin IDs remain `approval`, `field-customization` and `admin`. Inspection verifies only selected inventories and does not execute any runtime factory. `loadRegisteredPlatformModules` receives host-verified tenant IDs and bindings. `stagePlatformPackages` copies verified assets into staging; ship that entire tree and its fixed runtime dependencies.

Frontend and API/MCP components use their declared roles. Jobs/workflows use a configured Worker image; database components use the Oracle target. Required additional databases, existing resources, Functions, native capabilities or external services need explicit placements. Unresolved required components fail generation. Selecting code never grants tenant access.

### Generate infrastructure definitions

```bash
eaos preset:init
cd pulumi
bun install
pulumi stack init staging
pulumi preview
```

Set the actual compartment, availability domain, supported images, SSH CIDR/key, database version and storage namespace through the generated Pulumi schema. Supply database passwords as Pulumi secrets. Initialization writes source and preserves edits; preview does not apply resources.

The template describes an edge host, private ARM worker, NAT/service gateways, network ACLs, protected ADB, private versioned Object Storage and Vault. The host supplies IAM, DNS/TLS and explicit existing-resource adoption. `pulumi/custom.ts` can customize arguments or add resources. Keep secret outputs out of platform JSON and receipts.

### Resolve Kamal secrets

Use `renderKamalSecretsScript` from the supported `@alneas/eaos-cli/platform/kamal-secrets` entry. The generated `.kamal/secrets` template requires Kamal 2.12+ and Node.js 22+ when Kamal consumes it. Rendering itself reads no credentials and runs no external commands:

```typescript
import { mkdir, writeFile } from 'node:fs/promises'
import { renderKamalSecretsScript } from '@alneas/eaos-cli/platform/kamal-secrets'

await mkdir('.kamal', { recursive: true })
await writeFile('.kamal/secrets', renderKamalSecretsScript({
  tenancyNamespace: 'example-namespace',
  username: 'operator@example.com',
  pulumiDir: 'pulumi',
  authTokenSecretName: 'ocirAuthToken',
}), { flag: 'wx', mode: 0o600 })
```

Supply real values through the host's secret manager and process environment. Values must be nonblank, single-line strings without NUL, CR or LF. They are passed as data; dollar signs, quotes and command-looking contents are preserved.

| Binding | Resolution order |
| --- | --- |
| `KAMAL_REGISTRY_USERNAME` | Host environment, then explicit `defaultRegistryUser`, then namespace/domain/username options. |
| `KAMAL_REGISTRY_PASSWORD` | Host environment, then `OCI_AUTH_TOKEN`, then the selected Pulumi stack output. |
| `ADB_CONNECT_STRING` | Host environment, then the preset's `bindings.databaseConnection` Pulumi output. |
| `ADB_PASSWORD` | Mandatory host environment binding; no fixed default or Pulumi password export. |

`authTokenSecretName` selects a Pulumi output name, defaulting to `ocirAuthToken`; it is not an OCI Vault secret ID. The standard preset does not issue a registry token, so the host supplies an environment token or explicitly adds a secret-wrapped output to its own stack. Pulumi is needed only for unresolved token/connection bindings; each read is limited to 30 seconds and 1 MiB. Failed reads, invalid output data or missing mandatory bindings stop Kamal parsing. No Pulumi update is executed.

Review existing files before replacing them. Older generated templates contain a fixed database-password placeholder and must be regenerated; the function does not modify old files or live credentials. The default Pulumi directory is now `pulumi`, matching `preset:init`; hosts retaining the earlier `apps/pulumi/Pulumi` location must pass that path explicitly. Do not log resolved secrets, run `kamal secrets print` in shared logs, or commit plaintext secret values.

Worker and agent SSH settings inherit the resolved main user and port, including the main `root` default; role overrides remain explicit. OCI KMS length defaults use bytes: AES/ECDSA use 32 and RSA uses 256. Native key shapes retain precedence, and native Vault content overrides remain Pulumi secrets without being encoded again. The host still reviews key algorithms, curves and provider requirements.

### Choose an optional secret manager

EAOS does not require BWS, OCI Vault, Kamal or Pulumi for application SDK use. Choose your own secret manager and inject values through the host's runtime bindings. BWS (Bitwarden Secrets Manager) is the recommended portable example; OCI Vault is an additional option for hosts running on OCI. Neither integration adds an EAOS package dependency or enables itself automatically. The Core `SecretResolver` reads injected environment values; it does not fetch BWS or OCI Vault secrets itself.

The following host-owned wrapper validates all four Kamal bindings before starting Kamal, avoiding the resolver's existing Pulumi-output fallback. Save it as `scripts/kamal-with-secrets.mjs` in the consuming project. It requires Node.js 22+ and the Kamal template described above. Select `env` for values already injected by BWS or another manager, or explicitly select `oci-vault` to fetch all four values from OCI Vault. It never falls back between providers.

```javascript
import { execFileSync, spawnSync } from 'node:child_process'

const keys = ['KAMAL_REGISTRY_USERNAME', 'KAMAL_REGISTRY_PASSWORD',
  'ADB_CONNECT_STRING', 'ADB_PASSWORD']
const [provider, ...args] = process.argv.slice(2)
const env = { ...process.env }
const required = value => {
  if (typeof value !== 'string' || !value.trim() || /[\0\r\n]/.test(value)) {
    throw new Error('Invalid binding')
  }
  return value
}
try {
  if (!['env', 'oci-vault'].includes(provider) || !args.length) {
    throw new Error('Select a provider and Kamal arguments')
  }
  for (const key of keys) {
    if (provider === 'oci-vault') {
      const id = required(process.env[`OCI_SECRET_OCID_${key}`])
      const result = execFileSync('oci', [
        'secrets', 'secret-bundle', 'get', '--secret-id', id,
        '--stage', 'CURRENT', '--auth', 'instance_principal', '--output', 'json',
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 30000, maxBuffer: 1048576 })
      const content = JSON.parse(result).data['secret-bundle-content']
      if (content['content-type'] !== 'BASE64' ||
          typeof content.content !== 'string' ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content.content)) {
        throw new Error('Invalid bundle')
      }
      env[key] = new TextDecoder('utf-8', { fatal: true })
        .decode(Buffer.from(content.content, 'base64'))
    }
    env[key] = required(env[key])
  }
  delete env.BWS_ACCESS_TOKEN
} catch {
  console.error('Secret setup failed; Kamal was not started. Check provider access and bindings.')
  process.exit(1)
}
const child = spawnSync('kamal', args, { env, stdio: 'inherit', shell: false })
if (child.error) console.error('Kamal could not be started.')
process.exit(child.status ?? 1)
```

#### BWS: recommended portable example

Install the [BWS CLI](https://bitwarden.com/help/secrets-manager-cli/). Create a dedicated deployment project with exactly the four binding names above as its secret keys; keep names unique and avoid unrelated keys such as `PATH` or `NODE_OPTIONS`. Grant a machine account read access only to that project. Supply its `BWS_ACCESS_TOKEN` through your CI secret store or another protected bootstrap mechanism, never a committed file or literal command argument. Set `BWS_PROJECT_ID` to the selected project ID; it is a reference, not a credential.

After reviewing the generated Kamal configuration and authorizing a real deployment, run:

```bash
bws run --project-id "$BWS_PROJECT_ID" -- 'node scripts/kamal-with-secrets.mjs env deploy'
```

BWS injects the project values into the wrapper's process environment. The wrapper refuses missing bindings and removes the BWS access token from Kamal's child environment. BWS and its shell still receive that token during bootstrap; use trusted commands and do not enable shell tracing. This example does not create secrets or execute any deployment merely by generating documentation or the template.

#### OCI hosting: optional OCI Vault integration

On an OCI Compute deployment runner, install the [OCI CLI](https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/cmdref/secrets/secret-bundle/get.html) and configure an instance-principal dynamic group and IAM policy scoped to reading the required secret bundles. This identity belongs to the machine running the wrapper, even when Kamal deploys to another machine. Other runtimes need their own reviewed authentication adapter; this example deliberately uses instance principals without a stored OCI API private key.

Store the four values in OCI Vault and inject these reference variables into the runner: `OCI_SECRET_OCID_KAMAL_REGISTRY_USERNAME`, `OCI_SECRET_OCID_KAMAL_REGISTRY_PASSWORD`, `OCI_SECRET_OCID_ADB_CONNECT_STRING`, and `OCI_SECRET_OCID_ADB_PASSWORD`. The preset creates a Vault and key, but does not populate these secrets or provision their IAM access. Do not pass secret payloads as command arguments.

After reviewing the target configuration and authorizing deployment, run:

```bash
node scripts/kamal-with-secrets.mjs oci-vault deploy
```

The wrapper reads each `CURRENT` bundle through a captured pipe, validates and decodes its base64 UTF-8 content, then starts Kamal only after every binding is valid. Lookup failures produce a generic diagnostic; provider stderr and payloads are not printed. Rotation is picked up on the next invocation. Both recipes inject secrets into process memory and Kamal's normal deployment transport; access to those processes, containers and deployment hosts remains privileged.

#### Pulumi and verification

Pulumi remains optional. If you use the generated OCI stack, its `config.requireSecret('adminPassword')` still requires a configured Pulumi secret; BWS injection alone does not populate that configuration. A host-owned stack may instead read an injected value, reject missing input and wrap it with `pulumi.secret` before passing it as `adminPassword`. An OCI-hosted stack may similarly retrieve a Vault bundle under its own scoped identity. Keep retrieval explicit, never export passwords, and retain Pulumi secret annotations on resource inputs and sensitive outputs. Secret inputs passed to a provider can still be recorded as encrypted Pulumi state; choose and protect the state backend and encryption provider accordingly.

Verify the wrapper first with synthetic values and a stub deployment command. A missing binding, denied Vault read or malformed bundle must prevent Kamal from starting. With all four bindings present, the Kamal resolver does not invoke Pulumi. Check only binding presence and exit status; do not use `env`, `printenv`, shell tracing, `kamal secrets print` or secret-bearing configuration dumps in shared logs. Never write resolved values to source, generated platform JSON, images, documentation or receipts. These are optional host integration examples, not a built-in BWS/Vault client or an audit of a live environment.

### Bind reviewed host operations

Implement `PlatformOperations` in trusted `eaos.operations.ts` using `definePlatformOperations` from `@alneas/eaos-cli/platform/operations`. The host provides environment locking, lifecycle catalog/executors, health endpoints and bootstrap identity/control-DB/admin-code adapters. Real adapters must not be replaced by empty success callbacks. Store only hashes for short-lived single-use administrator codes and deliver the plaintext directly to the operator.

Configure immutable deployment images and existing Kamal/SSH bindings. Release rejects `dev`, `local` and `latest` tags. Host hooks may supply `deploy({ role, image, version, configFile, context })` and `bootstrap.provisionInfrastructure(context, stack)` to retain existing Kamal/Pulumi identities. Target versions and stack are checked before execution.

Inspect the plan before requesting a real operation:

```bash
eaos platform:generate
eaos bootstrap --stack org/example-platform/staging --plan
eaos release --plan
eaos up --plan
```

`--plan` does not import host operation code. Actual execution obtains both local and shared environment locks, verifies package/config/source/lockfile hashes, then performs the selected operation. Bootstrap applies infrastructure, initializes the control DB and identity, and delivers a one-use registration code. Release installs/updates selected lifecycle releases, requires drain for active upgrades, deploys Worker → Backend → Frontend and checks readiness plus `X-EAOS-Release` against each image version. It restores only activations that the operation itself suspended, then appends a receipt. New tenants are never enabled automatically.

### Supply a baseline or local Compose runtime

Pass reviewed `baselines: [{ backendId, baseline }]` with the matching target Data Contract. Existing ledgers require exact applied-history checksums and rebase without DDL; new databases apply target DDL normally. Preserve the source archive and old ledger. See [baseline generation](baseline.md) for disposable local Oracle/PostgreSQL/SQLite compilation; it does not inspect production databases.

For `eaos up`, the host supplies local origins, image builds and the runtime identity configuration/password-file contract. TLS directories are required when HTTPS is selected. The CLI does not replace existing passwords or volumes. Startup follows DB → identity migration → application, and readiness failures remain failures.

## Verification

Inspect generated inventory, runtime contract, placement plans and immutable image versions. Bind actual adapters under `src/` or `scripts/`; those, Pulumi sources and operation declarations participate in the release input hash. Every external adapter rechecks real state immediately before execution. Confirm role-specific readiness and version headers before accepting a deployed release.

## Troubleshooting / Common Pitfalls

- A required placement must resolve before generation; optional native features remain visibly unadopted.
- A failed step stops later steps and appends failure evidence. Reconcile dirty DDL and actual ledger state before retrying.
- Locks do not expire automatically. Inspect the owner and maintenance state before recovery.
- Resume suspended plugins with an explicit lifecycle operation after recovery.
- Private storage flags are not proof of actual provider protection. Check the host's real configuration.

See the provider specifications for [ADB network ACLs](https://www.pulumi.com/registry/packages/oci/api-docs/database/autonomousdatabase/) and [Object Storage privacy/versioning](https://www.pulumi.com/registry/packages/oci/api-docs/objectstorage/bucket/).

Kamal's [secret substitution](https://kamal-deploy.org/docs/configuration/environment-variables/) and [inline extractor implementation](https://github.com/basecamp/kamal/blob/v2.12.0/lib/kamal/secrets/dotenv/inline_command_substitution.rb) define template consumption. OCI [KMS key shapes](https://www.pulumi.com/registry/packages/oci/api-docs/kms/key/) define supported key lengths.
