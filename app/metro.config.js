const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
for (const ext of ['pdfjs', 'readerhtml', 'epub', 'azw3', 'pdf', 'txt']) {
  if (!config.resolver.assetExts.includes(ext)) config.resolver.assetExts.push(ext);
}

const stubPath = path.resolve(__dirname, 'src/shims/native-net.ts');
const previousResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    platform === 'web' &&
    (moduleName === 'react-native-tcp-socket' || moduleName === 'react-native-zeroconf')
  ) {
    return { type: 'sourceFile', filePath: stubPath };
  }
  if (previousResolve) return previousResolve(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
