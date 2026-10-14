import { PulseEngine } from './engine.mjs'
import { loadConfig } from './config.mjs'

const engine = new PulseEngine(loadConfig())
await engine.init()
await engine.cycle()
const snapshot = engine.snapshot()
console.log(JSON.stringify({ news: snapshot.news.length, funding: snapshot.funding.length, sources: snapshot.sources, channels: snapshot.channels, persistenceHealthy: snapshot.persistenceHealthy }, null, 2))
if (!snapshot.sources.some((source) => source.status === 'live' || source.status === 'demo') || !snapshot.persistenceHealthy) process.exitCode = 1
