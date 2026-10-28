// GitHub language links are repository navigation; the portal owns its language selector.
export function portalReadmeSource(source) {
 return source.replace(/^\[English\]\((?:README\.md|https:\/\/github\.com\/[^)\s]+\/README\.md)\) \| \[日本語\]\((?:README\.ja\.md|https:\/\/github\.com\/[^)\s]+\/README\.ja\.md)\)\r?\n(?:\r?\n)?/m, '');
}
