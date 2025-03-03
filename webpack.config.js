const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const HtmlWebpackHarddiskPlugin = require('html-webpack-harddisk-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');

const cesiumSource = "node_modules/cesium/Source";
const cesiumWorkers = "node_modules/cesium/Build/Cesium/Workers";
// const cesiumBaseUrl = "cesiumStatic";

const leafletSource = "node_modules/leaflet/dist";

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
                { from: path.join(__dirname, leafletSource), to: "leaflet" },
                { from: path.join(__dirname, leafletSource, 'images'), to: "leaflet/images" }
            ],
        }),
        new webpack.DefinePlugin({
            // Define relative base path in cesium for loading assets
            CESIUM_BASE_URL: JSON.stringify(""),
        }),
        new NodePolyfillPlugin(),
    ],
    mode: 'development',
    devtool: 'source-map', // Generate source maps for easier debugging
    resolve: {
        extensions: [".js", ".css"],
        modules: ["src", "node_modules"],
        alias: {
            cesium: path.resolve(__dirname, cesiumSource, "Cesium.js"),
            cesiumStyle: path.resolve(__dirname, cesiumSource, "Widgets", "widgets.css"),
            mainStyle: path.resolve(__dirname, 'src', 'styles', 'style.css'),
            leafletStyle: path.resolve(__dirname, 'node_modules', 'leaflet', 'dist', 'leaflet.css'),
            googleMapsLoader: path.resolve(__dirname, 'node_modules/@googlemaps/js-api-loader'),
        },
        fallback: {
            fs: false,
        },
    },
    amd: {
        // Enable webpack-friendly use of require in Cesium
        toUrlUndefined: true,
    },
    optimization: {
        splitChunks: {
            chunks: 'all',
        },
        runtimeChunk: 'single',
        minimize: true,
        // minimizer: [
        //     new TerserPlugin({
        //         terserOptions: {
        //             compress: {
        //                 drop_console: true,
        //             },
        //         },
        //         extractComments: false, // Do not extract comments to a separate file
        //     }),
        //     new CssMinimizerPlugin(),
        // ],
    },
};