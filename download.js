const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const clc = require('cli-color');

// Show progress of downloading file
const shouldShowProgress = false;

/**
 * Console log progress of downloading file
 * @param {string} file 
 * @param {int} cur 
 * @param {int} len 
 * @param {int} total 
 */
function showProgress(file, cur, len, total) {
    console.log(clc.yellow('Downloading'), file, clc.yellow((100.0 * cur / len).toFixed(2) + '%'), 'of', clc.yellow(total.toFixed(2)), 'MB');
}

/**
 * Get pathname without leading slash
 * @param {string} url 
 * @returns 
 */
function getPathnameWithoutLeadingSlash(url) {
    const myUrl = new URL(url);
    let pathname = myUrl.pathname;
    return pathname.startsWith('/') ? pathname.substring(1) : pathname;;
}

/**
 * Write array of strings to file, each element in new line
 * @param {string} filename 
 * @param {string[]} stringArray 
 */
function writeArrayToFile(filename, stringArray) {
    if (stringArray.length === 0) return;
    // Join array elements with new line
    const data = stringArray.join('\n');
    fs.stat(filename, (err, stats) => {
        if (err && err.code !== 'ENOENT') {
            console.error(`Error checking file ${filename}`, err);
            return;
        }
        const appendData = stats && stats.size > 0 ? '\n' + data : data;
        fs.appendFile(filename, appendData, 'utf8', (err) => {
            if (err) console.error(`Error writing to ${filename}`, err);
        });
    });
}

/**
 * Validate if file exists, if not, create the folder and resolve it
 * If file exists, reject it with reason 'exists'
 * @param {string} file /path/to/file
 * @returns 
 */
function validateFile(file) {
    return new Promise((resolve, reject) => {
        fs.access(file, fs.constants.F_OK, (err) => {
            // File does not exist
            if (err) {
                // check if the directory exists, if not, create it recursively
                const directory = path.dirname(file);
                fs.access(directory, fs.constants.F_OK, (err) => {
                    if (err) {
                        // Directory does not exist
                        fs.mkdir(directory, { recursive: true }, (err) => {
                            err ? reject({ reason: 'error', file: file, error: err }) : resolve();
                        });
                    } else {
                        resolve();
                    }
                });
            } else {
                reject({ reason: 'exists', file: file });
            }
        });
    });
}

/**
 * Download file from url and save it to file
 * @param {string} file 
 * @param {string} url 
 * @returns 
 */
function downloadRequest(file, url) {
    return new Promise((resolve, reject) => {
        let localFile = fs.createWriteStream(file);
        const client = (new URL(url)).protocol === 'https:' ? https : http;
        client.get(url, function (response) {
            var len = parseInt(response.headers['content-length'], 10);
            var cur = 0;
            var total = len / 1048576; //1048576 - bytes in 1 Megabyte

            response.on('data', function (chunk) {
                cur += chunk.length;
                if (shouldShowProgress)
                    showProgress(file, cur, len, total);
            });

            response.on('end', function () {
                resolve({ reason: 'success', file: file, url: url });
            });

            response.pipe(localFile);
        }).on('error', function (err) {
            reject({ reason: 'error', file: file, url: url, error: err });
            fs.unlink(file,
                (err) => {
                    if (err) reject({ reason: 'error', file: file, url: url, error: err });
                });
        });
    });
}

/**
 * Download file from url and save it to file
 * @param {string} url 
 * @returns 
 */
function downloadUrl(url) {
    return new Promise((resolve, reject) => {
        const file = getPathnameWithoutLeadingSlash(url);
        console.log(clc.yellow('To download'), url);
        validateFile(file)
            .then(() => {
                downloadRequest(file, url).then(() => {
                    resolve({ reason: 'success', file: file, url: url });
                }).catch((err) => {
                    reject({ reason: 'error', file: file, url: url, error: err });
                });
            })
            .catch((err) => {
                if (err.reason === 'exists') {
                    resolve({ reason: 'exists', file: file, url: url });
                } else {
                    reject({ reason: 'error', file: file, url: url, error: err });
                }
            });
    });
}

/**
 * Download files from urls
 * @param {string[]} urls 
 */
function downloadedUrls(urls) {
    const downloadPromises = [];
    urls.forEach(url => {
        downloadPromises.push(downloadUrl(url));
    });
    const downloadFailedArray = [];
    const downloadExistsArray = [];
    const downloadSuccessArray = [];

    Promise.allSettled(downloadPromises).then((results) => {
        results.forEach(result => {
            if (result.status === 'fulfilled') {
                if (result.value.reason === 'success') {
                    downloadSuccessArray.push(result.value.url);
                    console.log(clc.green('Downloaded'), result.value.url);
                } else if (result.value.reason === 'exists') {
                    downloadExistsArray.push(result.value.url);
                    console.log(clc.green('File exists'), result.value.url);
                }
            } else {
                downloadFailedArray.push(result.reason.url);
                console.log(clc.red('Failed to download'), result.reason.url, '\n', result.reason.error, '\n');
            }
        });
    }).catch((err) => {
        console.error('Promise.allSettled error', err);
    }).finally(() => {
        writeArrayToFile('download-failed.txt', downloadFailedArray);
        writeArrayToFile('download-exists.txt', downloadExistsArray);
        writeArrayToFile('download-success.txt', downloadSuccessArray);
        if (downloadExistsArray.length + downloadExistsArray.length + downloadSuccessArray.length === urls.length) {
            writeArrayToFile('download-finished.txt', urls);
            fs.writeFile('download-waiting.txt', '', 'utf8', (err) => {
                if (err) console.error(`Error writing to download-waiting.txt`, err);
            });
        }
    });
}

/**
 * Load urls from file and download them
 * @param {string} filename 
 */
function loadUrlsAndDownload(filename) {
    console.log(clc.green('Loading urls from'), clc.yellow(filename));
    fs.readFile(filename, 'utf8', (err, data) => {
        if (err) {
            console.error(clc.red('Error: Please put to-be-downloaded urls in file'), clc.yellow(filename), '\n', err);
            return;
        }
        // Split by new line and filter out empty lines
        const urls = data.split('\n').filter(Boolean);
        downloadedUrls(urls);
    });
}

if (!process.argv[2]) {
    console.error(clc.red('Error: Please provide filename as argument'));
    return;
}

loadUrlsAndDownload(process.argv[2]);