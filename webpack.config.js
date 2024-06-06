const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const HtmlWebpackHarddiskPlugin = require('html-webpack-harddisk-plugin');
const CopywebpackPlugin = require('copy-webpack-plugin');
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');
const url = require('url');
const webpack = require('webpack');

const cesiumSource = "node_modules/cesium/Source";
const cesiumWorkers = "../Build/Cesium/Workers";

module.exports = {
    entry: ['./src/scripts/index.js', "./src/style.css"], // Your entry point
    output: {
        filename: "[name].js",
        path: path.resolve(__dirname, 'dist'), // Output directory
        clean: true,
        sourcePrefix: "",
    },
    module: {
        rules: [
            {
                test: /\.css$/i,
                use: ['style-loader', 'css-loader'],
            }
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
        new CopywebpackPlugin({
            patterns: [
                { from: path.join(cesiumSource, cesiumWorkers), to: "Workers" },
                { from: path.join(cesiumSource, "Assets"), to: "Assets" },
                { from: path.join(cesiumSource, "Widgets"), to: "Widgets" },
                { from: path.join(cesiumSource, "ThirdParty"), to: "ThirdParty" },
                // { from: "public/assets/", to: "" },
                // { from: '../node_modules/cesium/Build/Cesium/ThirdParty', to: 'ThirdParty' },
            ],
        }),
        new webpack.DefinePlugin({
            // Define relative base path in cesium for loading assets
            CESIUM_BASE_URL: JSON.stringify(""),
        }),
        new NodePolyfillPlugin(),
    ],
    devServer: {
        static: path.join(__dirname, "dist"),
        hot: true, // Enable hot module replacement
    },
    mode: 'development',
    devtool: 'source-map',
    resolve: {
        extensions: [".js", ".ts"],
        modules: ["src", "node_modules"],
        alias: {
            // CesiumJS module name
            cesium: path.resolve(__dirname, cesiumSource),
        },
        fallback: {
            fs: false,
            url: url.pathToFileURL("./node_modules/url/url.js").href,
            zlib: false,
        },
    },
    amd: {
        // Enable webpack-friendly use of require in Cesium
        toUrlUndefined: true,
    },
};