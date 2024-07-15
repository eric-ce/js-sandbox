const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const HtmlWebpackHarddiskPlugin = require('html-webpack-harddisk-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');
const url = require('url');
const webpack = require('webpack');

const cesiumSource = "node_modules/cesium/Source";
const cesiumWorkers = "node_modules/cesium/Build/Cesium/Workers";
// const cesiumBaseUrl = "cesiumStatic";

module.exports = {
    entry: ['./src/index.js'], // Your entry point
    output: {
        filename: "[name].bundle.js",
        path: path.resolve(__dirname, 'dist'), // Output directory
        clean: true,
        sourcePrefix: "",
    },
    module: {
        rules: [
            {
                test: /\.css$/i,
                use: ['style-loader', 'css-loader'],
            },
            {
                test: /\.(png|gif|jpg|jpeg|svg|xml|json)$/i,
                use: ['file-loader'],
            },
        ]
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: './src/index.html', // Path to your HTML file
            alwaysWriteToDisk: true,
            inject: 'body',
        }),
        new HtmlWebpackHarddiskPlugin(),
        new webpack.HotModuleReplacementPlugin(),
        // Copy Cesium Assets, Widgets, and Workers to a static directory
        new CopyWebpackPlugin({
            patterns: [
                { from: path.join(cesiumWorkers), to: "Workers" },
                { from: path.join(cesiumSource, "Assets"), to: "Assets" },
                { from: path.join(cesiumSource, "Widgets"), to: "Widgets" },
                { from: path.join(cesiumSource, "ThirdParty"), to: "ThirdParty" },
            ],
        }),
        new webpack.DefinePlugin({
            // Define relative base path in cesium for loading assets
            CESIUM_BASE_URL: JSON.stringify(""),
        }),
        new NodePolyfillPlugin(),
    ],
    output: {
        filename: "[name].bundle.js",
        path: path.resolve(__dirname, 'dist'), // Output directory
        clean: true,
    },
    mode: 'development',
    devtool: 'inline-source-map',
    resolve: {
        extensions: [".js", ".css"],
        modules: ["src", "node_modules"],
        alias: {
            cesium: path.resolve(__dirname, cesiumSource, "Cesium.js"),
            cesiumStyle: path.resolve(__dirname, cesiumSource, "Widgets", "widgets.css"),
            mainStyle: path.resolve(__dirname, 'src', 'style.css'),
        },
        fallback: {
            fs: false,
        },
    },
    amd: {
        // Enable webpack-friendly use of require in Cesium
        toUrlUndefined: true,
    },
};