import {AssetBuilderEventList} from "@labor-digital/asset-building/dist/AssetBuilderEventList";
import {CoreContext} from "@labor-digital/asset-building/dist/Core/CoreContext";
import {WorkerContext} from "@labor-digital/asset-building/dist/Core/WorkerContext";
import merge from "webpack-merge";

export default function (context: WorkerContext | CoreContext, scope: string) {

	// Ignore when called in the global context
	if (context.type === "worker") context = context.parentContext;
	context = context as CoreContext;
	if (scope !== "app" && context.process !== "worker") return;

	// Ignore if this is not a build for production
	if (!context.isProd) return;

	((context: CoreContext) => {

		// Ignore if we don't have a sentry config file
		const configFile = (() => {
			if (typeof process.env.SENTRY_CONFIG_FILE_LOCATION === "undefined") {
				const path = require("path");
				let basePath = context.sourcePath;
				if (typeof process.env.BITBUCKET_CLONE_DIR !== "undefined")
					basePath = process.env.BITBUCKET_CLONE_DIR;
				const tmp = path.join(basePath, "sentry-configuration-file.json");
				if (require("fs").existsSync(tmp)) return tmp;
				return "";
			}
		})();

		// Return if we have nothing to do...
		if (configFile === "") {
			console.log("Could not find Sentry.io config file, because neither SENTRY_CONFIG_FILE_LOCATION nor BITBUCKET_CLONE_DIR are defined as environment variables");
			return;
		}

		// Get release token from environment if possible
		const releaseToken = process.env.SENTRY_RELEASE_TOKEN;
		if (typeof releaseToken === "undefined") {
			console.log("Could not find Sentry.io release token in the SENTRY_RELEASE_TOKEN environment variable");
			return;
		}

		// Add our custom configuration
		context.eventEmitter.bind(AssetBuilderEventList.APPLY_EXTENSION_WEBPACK_CONFIG, (e) => {
			const fs = require("fs");
			const workerContext: WorkerContext = e.args.context;

			// Load the config file
			const config = JSON.parse(fs.readFileSync(configFile));

			// Write the temporary sentry configuration file
			const properties = [
				"auth.token=" + releaseToken,
				"defaults.org=" + config.organization,
				"defaults.project=" + config.project
			];
			const propertiesFile = context.workDirectoryPath + "sentry.properties";
			fs.writeFileSync(propertiesFile, properties.join("\r\n"));

			// Inject source map sentry plugin
			const SentryCliPlugin = require("@sentry/webpack-plugin");
			workerContext.webpackConfig = merge(workerContext.webpackConfig, {
				plugins: [
					new SentryCliPlugin({
						include: ".",
						configFile: propertiesFile,
						ignore: ["node_modules"],
						release: config.sdk.release
					})
				]
			});

			// Inject the config file into the webpack build context
			console.log("Injecting sentry.io configuration into the built bundle. Location: process.env.LABOR_SENTRY_CONFIG");

			workerContext.webpackConfig = merge(workerContext.webpackConfig, {
				plugins: [
					new (require("webpack")).DefinePlugin({
						"process.env.LABOR_SENTRY_CONFIG": JSON.stringify(config.sdk)
					})
				]
			});
		});
	})(context);
}