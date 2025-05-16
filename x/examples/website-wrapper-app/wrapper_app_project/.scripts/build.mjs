// Copyright 2025 The Outline Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import { exec, execFile } from 'node:child_process'
import fs, { promises as fsp } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import chalk from 'chalk'
import { glob } from 'glob'
import handlebars from 'handlebars'

const TEMPLATE = path.join(process.cwd(), 'wrapper_app_project/template');

import { getCliConfig, getFileConfig, DEFAULT_CONFIG } from './config.mjs'
import { resolveTemplateArguments, zip } from './util.mjs'

/* See https://stackoverflow.com/questions/57838022/detect-whether-es-module-is-run-from-command-line-in-node*/
if (import.meta.url !== pathToFileURL(`${process.argv[1]}`).href) {
  throw new Error('Build script must be run from the cli')
}

const CONFIG = {
  ...DEFAULT_CONFIG,
  ...(await getFileConfig('config.yaml')),
  ...getCliConfig(process.argv)
}

if (!CONFIG.platform) {
  throw new Error(`Parameter \`--platform\` not provided.`);
}

if (!CONFIG.entryUrl) {
  throw new Error(`Parameter \`--entryUrl\` not provided.`);
}

/**
 * 
 **/
async function main(
  {
    additionalDomains,
    appId,
    appName,
    entryUrl,
    navigationUrl,
    output,
    platform,
    smartDialerConfig,
  },
) {
  
  /** TO REVIEW> */
  let templateArguments
  
  try {
    templateArguments = resolveTemplateArguments(platform, entryUrl, {
      additionalDomains,
      appId,
      appName,
      navigationUrl,
      smartDialerConfig,
    })
  } catch (cause) {
    throw new TypeError("Failed to resolve the project template arguments", {
      cause,
    })
  }
  /** <TO REVIEW */
  
  
  /** can't we do something with appName */
  const WRAPPER_APP_OUTPUT_TARGET = path.resolve(output, "wrapper_app_project")
  const WRAPPER_APP_OUTPUT_ZIP = path.resolve(output, "wrapper_app_project.zip")

  const SDK_MOBILEPROXY_OUTPUT_TARGET = path.resolve(output, "mobileproxy")
  const WRAPPER_APP_OUTPUT_SDK_MOBILEPROXY_DIR = path.resolve(WRAPPER_APP_OUTPUT_TARGET, "mobileproxy")

  try {
    await fsp.access(SDK_MOBILEPROXY_OUTPUT_TARGET, fsp.constants.F_OK)
  } catch (err) {
    console.log(chalk.green(`Building the Outline SDK mobileproxy library for ${platform}...`))
    await promisify(execFile)("npm", ["run", "build:mobileproxy", platform, output])
  }

  /** HERE WE ARE... */

  const sourceFilepaths = await glob(
    path.join(TEMPLATE, "**", "*"),
    {
      nodir: true,
      dot: true,
    },
  )

  console.log(chalk.green("Building project from template..."))

  for (const sourceFilepath of sourceFilepaths) {
    const destinationFilepath = path.join(
      WRAPPER_APP_OUTPUT_TARGET,
      path.relative(
        TEMPLATE,
        sourceFilepath,
      ),
    );

    // ensure directory
    fs.mkdirSync(path.dirname(destinationFilepath), { recursive: true });

    if (!sourceFilepath.endsWith(".handlebars")) {
      fs.copyFileSync(sourceFilepath, destinationFilepath);
      continue;
    }

    const template = handlebars.compile(
      fs.readFileSync(sourceFilepath, "utf8"),
    );

    fs.writeFileSync(
      destinationFilepath.replace(/\.handlebars$/, ""),
      template(templateArguments),
      "utf8",
    );
  }

  console.log(chalk.gray("Copying mobileproxy files into the project..."))

  fs.cpSync(
    SDK_MOBILEPROXY_OUTPUT_TARGET,
    WRAPPER_APP_OUTPUT_SDK_MOBILEPROXY_DIR,
    { recursive: true },
  );

  console.log(chalk.gray("Installing external dependencies for the project..."))
  await promisify(exec)(`
    cd ${WRAPPER_APP_OUTPUT_TARGET.replaceAll(" ", "\\ ")}
    npm install
    npx cap sync ${platform}
  `);

  console.log(chalk.gray(`Zipping project to ${chalk.blue(WRAPPER_APP_OUTPUT_ZIP)}...`))
  await zip(WRAPPER_APP_OUTPUT_TARGET, WRAPPER_APP_OUTPUT_ZIP);

  console.log(chalk.bgGreen("Project ready!"))
}

main(CONFIG)