import { promises as fs } from 'node:fs'
import path from 'node:path'

import * as cheerio from 'cheerio'
import minimist from 'minimist'
import YAML from 'yaml'


export const DEFAULT_CONFIG = {
  output: path.join(process.cwd(), 'output'),
  smartDialerConfig: JSON.stringify({
    dns: [
      {
        https: { name: '9.9.9.9' }
      }
    ],
    tls: [
      '',
      'split:1',
      'split:2',
      'tlsfrag:1'
    ],   
  })
}

export function getCliConfig(args) {
  const dict = minimist(args)
  return {
    ...dict,
    additionalDomains: dict.additionalDomains?.split(',') ?? []
  }
}

export async function getManifestConfig(entryUrl) {
  const url = new URL(entryUrl)
  const entryResponse = await fetch(url)
  const headers = entryResponse.headers
  const $ = cheerio.load(await entryResponse.text())
  const $manifest = $('link[rel=manifest]')
  const manifestLocation = new URL($manifest[0].attribs.href, url)
  const manifestResponse = await fetch(manifestLocation)
  const manifest = await manifestResponse.json()
  //  console.log(headers)
  // console.log(manifest)
  // pull appropriate media from the server
  
  const start_url = manifest.start_url ? new URL(manifest.start_url, entryUrl) : undefined
  
  // fetch icons
  if (Array.isArray(manifest.icons)) {
  }

  const return_val = {
    //...(), // platform (no relevant field in manifest.json)
    ...(start_url ? {entyrUrl: start_url.href} : {}), // entryUrl (wholly specified on the cli; even to fetch manifest.json)
    ...(start_url ? {entryDomain: start_url.origin} : {}), // entryDomain
    ...(manifest.name ? {name: manifest.name} : {}), // appName
    //...(), // appId
    //...(), // additionalDomains
    //...(), // domainList
    //...(), // smartDialerConfig (no relevant field in manifest.json)
    //...(), // output (seems very silly here!)
  }
  console.log(return_val)
  return return_val
}

export async function getYAMLFileConfig(filepath) {
  const data = await fs.readFile(filepath, 'utf8')
  if (data) {
    return YAML.parse(data)
  }
}