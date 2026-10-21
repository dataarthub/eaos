# Pending changes

Run `bun run changeset` to record package targets, version impact and consumer
upgrade actions. Preserve pending fragments until a reviewed release-preparation
change consumes them into the owning package's cumulative CHANGELOG.md.

See [release preparation](../RELEASING.md). Fragments are never packed into npm
archives, and a prepared version entry does not establish publication.
