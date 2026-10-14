import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function loadState(dataDir) {
  try {
    const state = JSON.parse(await readFile(join(dataDir, 'state.json'), 'utf8'))
    if (state.version !== 1 || !['news', 'funding', 'queue', 'sources', 'knownIds', 'initializedSources', 'deliveryLog'].every((key) => Array.isArray(state[key])) || !state.destinations || typeof state.destinations !== 'object') throw new Error('Estado incompatível')
    return state
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Não foi possível ler data/state.json. Preserve o arquivo e verifique o conteúdo antes de reiniciar.', { cause: error })
    return { version: 1, news: [], funding: [], sources: [], knownIds: [], initializedSources: [], destinations: {}, queue: [], deliveryLog: [], lastBriefDate: null, lastCycleAt: null }
  }
}
export async function saveState(dataDir, state) {
  await mkdir(dataDir, { recursive: true })
  const path = join(dataDir, 'state.json')
  await writeFile(`${path}.tmp`, `${JSON.stringify(state)}\n`, { mode: 0o600 })
  await rename(`${path}.tmp`, path)
}
