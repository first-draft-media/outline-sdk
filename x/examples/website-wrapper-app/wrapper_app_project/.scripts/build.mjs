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

import archiver from 'archiver'
import chalk from 'chalk'
import { glob } from 'glob'
import handlebars from 'handlebars'
import minimist from 'minimist'
import YAML from 'yaml'

const CWD = process.cwd()
const OUTPUT_TARGET = path.join(CWD, 'output')
const TEMPLATE = path.join(CWD, 'wrapper_app_project/template');

/**
 * GUARDS
 **/

/* See https://stackoverflow.com/questions/57838022/detect-whether-es-module-is-run-from-command-line-in-node*/
if (import.meta.url !== pathToFileURL(`${process.argv[1]}`).href) {
  throw new Error('Build script must be run from the cli')
}

/**
 * Read build configuration
 **/

const DEFAULT_CONFIG = {
  smartDialerConfig: JSON.stringify({
    dns: [
      {
        https: { name: "9.9.9.9" }
      }
    ],
    tls: [
      "",
      "split:1",
      "split:2",
      "tlsfrag:1"
    ],   
  })
}

// console.log(DEFAULT_CONFIG)

const YAML_CONFIG = await (async () => {
  const data = await fsp.readFile('config.yaml', 'utf8')
    .catch((e) => {
      if (e?.code === 'ENOENT') {
        return undefined
      } else if (e) {
        throw new Error(e)
      }
    })
  if (data) {
    const dict = YAML.parse(data)
    return {
      ...dict, 
      smartDialerConfig: dict.smartDialerConfig && JSON.stringify(dict.smartDialerConfig)
    }
  }
})()

// console.log(YAML_CONFIG)

/**
 * Parse cli arguments; invoke the main build function 
 **/  
 
const CLI_CONFIG = (() => {
  const args = minimist(process.argv.slice(2));
  return {
    ...args,
    additionalDomains: args.additionalDomains?.split(',') ?? []
  }
})()

// console.log(CLI_CONFIG)

const CONFIG = {
  ...DEFAULT_CONFIG,
  ...YAML_CONFIG,
  ...CLI_CONFIG
}

if (!CONFIG.platform) {
  throw new Error(`Parameter \`--platform\` not provided.`);
}

if (!CONFIG.entryUrl) {
  throw new Error(`Parameter \`--entryUrl\` not provided.`);
}

console.log(CONFIG)


main(CONFIG)
  .catch(console.error);

/***
 * DEFAULT EXPORT / BUILD ROUTINE
 **/

// Why do this is we can only be run as a script anyway?
export default async function main(
  {
    additionalDomains = [],
    appId,
    appName,
    entryUrl = "https://www.example.com",
    navigationUrl,
    output = OUTPUT_TARGET,
    platform,
    smartDialerConfig = SMART_DIALER_CONFIG,
  },
) {
  const WRAPPER_APP_OUTPUT_TARGET = path.resolve(output, "wrapper_app_project");
  const WRAPPER_APP_OUTPUT_ZIP = path.resolve(
    output,
    "wrapper_app_project.zip",
  );

  const SDK_MOBILEPROXY_OUTPUT_TARGET = path.resolve(output, "mobileproxy");
  const WRAPPER_APP_OUTPUT_SDK_MOBILEPROXY_DIR = path.resolve(
    WRAPPER_APP_OUTPUT_TARGET,
    "mobileproxy",
  );

  if (!fs.existsSync(SDK_MOBILEPROXY_OUTPUT_TARGET)) {
    console.log(
      `Building the Outline SDK mobileproxy library for ${platform}...`,
    );

    await promisify(execFile)("npm", [
      "run",
      "build:mobileproxy",
      platform,
      output,
    ], { shell: false });
  }

  const sourceFilepaths = await glob(
    path.join(TEMPLATE, "**", "*"),
    {
      nodir: true,
      dot: true,
    },
  );

  console.log("Building project from template...");

  let templateArguments;

  try {
    templateArguments = resolveTemplateArguments(platform, entryUrl, {
      additionalDomains,
      appId,
      appName,
      navigationUrl,
      smartDialerConfig,
    });
  } catch (cause) {
    throw new TypeError("Failed to resolve the project template arguments", {
      cause,
    });
  }

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

  console.log("Copying mobileproxy files into the project...");

  fs.cpSync(
    SDK_MOBILEPROXY_OUTPUT_TARGET,
    WRAPPER_APP_OUTPUT_SDK_MOBILEPROXY_DIR,
    { recursive: true },
  );

  console.log("Installing external dependencies for the project...");
  await promisify(exec)(`
    cd ${WRAPPER_APP_OUTPUT_TARGET.replaceAll(" ", "\\ ")}
    npm install
    npx cap sync ${platform}
  `);

  console.log(`Zipping project to ${chalk.blue(WRAPPER_APP_OUTPUT_ZIP)}...`);
  await zip(WRAPPER_APP_OUTPUT_TARGET, WRAPPER_APP_OUTPUT_ZIP);

  console.log("Project ready!");
}

function zip(root, destination) {
  const job = archiver("zip", { zlib: { level: 9 } });
  const destinationStream = fs.createWriteStream(destination);

  return new Promise((resolve, reject) => {
    job.directory(root, false);
    job.pipe(destinationStream);

    destinationStream.on("close", resolve);

    job.on("error", reject);
    destinationStream.on("error", reject);

    job.finalize();
  });
}

function resolveTemplateArguments(
  platform,
  entryUrl,
  {
    appId,
    appName,
    navigationUrl,
    additionalDomains,
    smartDialerConfig,
  },
) {
  const result = {
    platform,
    entryUrl,
    entryDomain: new URL(entryUrl).hostname,
  };

  if (!appId) {
    // Infer an app ID from the entry domain by reversing it (e.g. `www.example.com` becomes `com.example.www`)
    // It must be lower case, and hyphens are not allowed.
    result.appId = result.entryDomain.replaceAll("-", "")
      .toLocaleLowerCase().split(".").reverse().join(".");
  }

  if (!appName) {
    // Infer an app name from the base entry domain part by title casing the root domain:
    // (e.g. `www.my-example-app.com` becomes "My Example App")
    const rootDomain = result.entryDomain.split(".").reverse()[1];

    result.appName = rootDomain.toLocaleLowerCase().replaceAll(
      /\w[a-z0-9]*[-_]*/g,
      (match) => {
        match = match.replace(/[-_]+/, " ");

        return match.charAt(0).toUpperCase() + match.slice(1).toLowerCase();
      },
    );
  }

  if (navigationUrl) {
    result.entryUrl = navigationUrl;
    result.entryDomain = new URL(navigationUrl).hostname;
  }

  if (typeof additionalDomains === "string") {
    result.additionalDomains = additionalDomains.split(/,\s*/);
    result.domainList = [result.entryDomain, ...result.additionalDomains].join(
      "\\n",
    );
  } else if (typeof additionalDomains === "object") {
    result.additionalDomains = additionalDomains;
    result.domainList = [result.entryDomain, ...result.additionalDomains].join(
      "\\n",
    );
  } else {
    result.domainList = [result.entryDomain];
  }

  result.smartDialerConfig = Buffer.from(smartDialerConfig).toString("base64");

  return result;
}
