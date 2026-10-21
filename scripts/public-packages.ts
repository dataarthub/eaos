/** Four Framework foundations and one collection of independent MIT plugin modules. */
export const publicPackages = [
  ...['core', 'server', 'react', 'cli'].map(id => ({ id, directory: `packages/${id}`, foundation: true })),
  { id: 'plugins', directory: 'plugins', foundation: false },
]
