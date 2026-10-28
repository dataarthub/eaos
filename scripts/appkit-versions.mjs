import semver from 'semver'
// Registry versions used by package validation and isolated consumers.
export const appkitVersions = { '@alneas/appkit-core': '0.2.0', '@alneas/appkit-react': '0.3.0' }

// Appkit package lines are independently versioned; admit only compatible releases.
export function supportedAppkitRange(name, range) {
 const minimum=appkitVersions[name]
 return !minimum || typeof range==='string' && !!semver.validRange(range) && semver.subset(range, '^'+minimum) && !!semver.minVersion(range)
}
