import fs from 'node:fs'

import archiver from 'archiver'



export function resolveTemplateArguments(
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

export function zip(root, destination) {
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