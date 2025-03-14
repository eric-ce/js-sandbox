const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const HtmlWebpackHarddiskPlugin = require('html-webpack-harddisk-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');

const cesiumSource = "node_modules/cesium/Source";
const cesiumWorkers = "node_modules/cesium/Build/Cesium/Workers";
const leafletSource = "node_modules/leaflet/dist";

module.exports = {
    entry: './src/index.js', // No need for array with single entry point
    output: {
        filename: "[name].bundle.js",
        path: path.resolve(__dirname, 'dist'),
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
                // Use asset/resource instead of file-loader (Webpack 5)
                test: /\.(png|gif|jpg|jpeg|svg|xml|json)$/i,
                type: 'asset/resource',
            },
        ]
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: './src/index.html',
            alwaysWriteToDisk: true,
            inject: 'body',
        }),
        new HtmlWebpackHarddiskPlugin(),
        new webpack.HotModuleReplacementPlugin(),
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
            CESIUM_BASE_URL: JSON.stringify(""),
        }),
        new NodePolyfillPlugin(),
    ],
    mode: 'development',
    devtool: 'eval-source-map', // Faster rebuilds with good enough debugging
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
        // Don't minimize for faster rebuilds in development
        minimize: false,

        // Still use code splitting for better caching and performance
        splitChunks: {
            chunks: 'all',
            cacheGroups: {
                // Separate cesium into its own chunk
                cesium: {
                    test: /[\\/]node_modules[\\/]cesium[\\/]/,
                    name: 'cesium',
                    chunks: 'all',
                    priority: 10
                },
                // Group other node_modules together
                vendors: {
                    test: /[\\/]node_modules[\\/]/,
                    name: 'vendors',
                    chunks: 'all',
                    priority: 5
                },
            },
        },
        runtimeChunk: 'single',

        // These optimizations don't hurt build time much but help with development
        concatenateModules: true,
        usedExports: true,
    },
    // Add dev server for better development experience
    devServer: {
        static: {
            directory: path.join(__dirname, 'dist'),
        },
        hot: true,
        open: true,
        compress: true,
        historyApiFallback: true,
        client: {
            overlay: true,
            progress: true,
        },
        // Disable host checking for easier network access
        allowedHosts: 'all',
    },
    cache: {
        type: 'filesystem', // Use filesystem caching for faster rebuilds
    },
    stats: {
        colors: true,
        assets: false,
        modules: false,
    },
};