const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The shared logic lives outside this folder, so Metro has to be told to watch it.
config.watchFolders = [path.resolve(__dirname, '../packages/shared')];

module.exports = config;
