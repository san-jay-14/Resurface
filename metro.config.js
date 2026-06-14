const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

const wrapped = withNativeWind(config, { input: "./global.css" });

// Push after wrap so NativeWind doesn't clobber the list
wrapped.resolver.assetExts.push("lottie");

module.exports = wrapped;
