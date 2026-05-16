const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Custom Expo Config Plugin to safely modify the generated AndroidManifest.xml
 * It bypasses the Health Connect API 26 minimum constraint by injecting the
 * tools:overrideLibrary rule directly into the <uses-sdk> native AST node.
 */
function withManifestOverride(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;

    // 1. Defensively initialize the root <manifest> attributes object
    if (!manifest.manifest) manifest.manifest = {};
    if (!manifest.manifest.$) manifest.manifest.$ = {};

    // 2. Ensure the tools namespace is explicitly declared in the root node
    if (!manifest.manifest.$['xmlns:tools']) {
      manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    // 3. Defensively initialize the <uses-sdk> array node
    if (!manifest.manifest['uses-sdk'] || !Array.isArray(manifest.manifest['uses-sdk'])) {
      manifest.manifest['uses-sdk'] = [{}];
    }

    const usesSdk = manifest.manifest['uses-sdk'][0];
    if (!usesSdk.$) usesSdk.$ = {};
    
    // 4. Inject the tools:overrideLibrary rule
    const newOverride = 'androidx.health.connect.client';
    const currentOverride = usesSdk.$['tools:overrideLibrary'];

    if (currentOverride) {
      if (!currentOverride.includes(newOverride)) {
        usesSdk.$['tools:overrideLibrary'] = `${currentOverride},${newOverride}`;
      }
    } else {
      usesSdk.$['tools:overrideLibrary'] = newOverride;
    }

    return config;
  });
}

module.exports = withManifestOverride;
