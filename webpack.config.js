const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
    mode: 'development',
    entry: ['./src/scripts/index.js', "./src/style.css"], // Your entry point
    devtool: 'inline-source-map',
    devServer: {
        static: path.join(__dirname, "dist"),
        hot: true, // Enable hot module replacement
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
        })
    ],
    output: {
        filename: "[name].bundle.js",
        path: path.resolve(__dirname, 'dist'), // Output directory
        clean: true,
    },
};