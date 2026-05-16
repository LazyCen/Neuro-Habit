module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // IMPORTANT: react-native-reanimated/plugin MUST be the last plugin.
      // With newArchEnabled: true, babel-preset-expo runs the React Compiler
      // which transforms component code. If Reanimated's worklet compiler
      // doesn't have the final pass, useAnimatedStyle callbacks aren't properly
      // compiled as worklets, causing .value reads to trigger the strict-mode
      // "Reading from value during component render" warning.
      'react-native-reanimated/plugin',
    ],
    env: {
      production: {
        plugins: ['transform-remove-console'],
      },
    },
  };
};
