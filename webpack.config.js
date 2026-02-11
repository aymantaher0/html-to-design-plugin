const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const HtmlInlineScriptPlugin = require('html-inline-script-webpack-plugin');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';

  return [
    // Plugin controller (sandbox code)
    {
      entry: './src/code.ts',
      output: {
        filename: 'code.js',
        path: path.resolve(__dirname, 'dist'),
      },
      module: {
        rules: [
          {
            test: /\.ts$/,
            use: 'ts-loader',
            exclude: /node_modules/,
          },
        ],
      },
      resolve: {
        extensions: ['.ts', '.js'],
      },
      mode: isProduction ? 'production' : 'development',
      devtool: isProduction ? false : 'inline-source-map',
    },
    // Plugin UI - inlines JS into HTML (required for Figma plugins)
    {
      entry: './src/ui/ui.ts',
      output: {
        filename: 'ui.js',
        path: path.resolve(__dirname, 'dist'),
      },
      module: {
        rules: [
          {
            test: /\.ts$/,
            use: 'ts-loader',
            exclude: /node_modules/,
          },
          {
            test: /\.css$/,
            use: ['style-loader', 'css-loader'],
          },
        ],
      },
      resolve: {
        extensions: ['.ts', '.js'],
      },
      plugins: [
        new HtmlWebpackPlugin({
          template: './src/ui/ui.html',
          filename: 'ui.html',
          inject: 'body',
        }),
        new HtmlInlineScriptPlugin(),
      ],
      mode: isProduction ? 'production' : 'development',
      devtool: isProduction ? false : 'inline-source-map',
    },
  ];
};
