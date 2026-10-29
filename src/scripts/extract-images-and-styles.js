const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/*
 * Configuration
 */
const inputFile = path.resolve("src/scripts/dist/input.html");
const outputFile = path.resolve("src/scripts/dist/output.html");

const imagesDirectory = path.resolve("src/scripts/dist/images");
const imagesHtmlPath = "images";

const cssFile = path.resolve("src/scripts/dist/styles/report.css");
const cssHtmlPath = "styles/report.css";

/*
 * Supported image MIME types and their file extensions.
 */
const extensionMap = {
    jpeg: "jpg",
    jpg: "jpg",
    png: "png",
    gif: "gif",
    webp: "webp",
    "svg+xml": "svg",
    bmp: "bmp",
    avif: "avif",
    "x-icon": "ico",
    "vnd.microsoft.icon": "ico",
};

/*
 * Matches Base64 image data URLs anywhere in the HTML or CSS.
 */
const dataImagePattern =
    /data:image\/([a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\r\n\t ]+)/g;

/*
 * Matches complete <style> elements.
 */
const styleElementPattern = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;

function extractBase64Images(content, savedImages, stats) {
    return content.replace(
        dataImagePattern,
        (fullMatch, imageType, base64Data) => {
            stats.totalImageOccurrences += 1;

            const normalizedImageType = imageType.toLowerCase();
            const extension =
                extensionMap[normalizedImageType] || normalizedImageType;

            const normalizedBase64 = base64Data.replace(/\s/g, "");

            const imageBuffer = Buffer.from(normalizedBase64, "base64");

            if (imageBuffer.length === 0) {
                console.warn(
                    `Image occurrence ${stats.totalImageOccurrences} is empty. It will remain unchanged.`,
                );

                return fullMatch;
            }

            /*
             * Hash the decoded binary content.
             */
            const hash = crypto
                .createHash("sha256")
                .update(imageBuffer)
                .digest("hex");

            /*
             * Use the first 20 characters to keep filenames reasonably short.
             */
            const shortHash = hash.slice(0, 20);

            const imageKey = `${hash}.${extension}`;
            const filename = `${shortHash}.${extension}`;
            const imagePath = path.join(imagesDirectory, filename);

            if (!savedImages.has(imageKey)) {
                fs.writeFileSync(imagePath, imageBuffer);

                savedImages.set(imageKey, filename);
                stats.uniqueImages += 1;
            }

            const savedFilename = savedImages.get(imageKey);

            /*
             * Paths in HTML and CSS should always use forward slashes.
             */
            return path.posix.join(imagesHtmlPath, savedFilename);
        },
    );
}

function extractStyleElements(html) {
    const styleBlocks = [];

    const htmlWithoutStyles = html.replace(
        styleElementPattern,
        (fullMatch, cssContent) => {
            const trimmedCss = cssContent.trim();

            if (trimmedCss) {
                styleBlocks.push(trimmedCss);
            }

            return "";
        },
    );

    return {
        html: htmlWithoutStyles,
        css: styleBlocks.join("\n\n"),
        numberOfStyleElements: styleBlocks.length,
    };
}

function addStylesheetLink(html) {
    const stylesheetLink = `<link rel="stylesheet" href="${cssHtmlPath}">`;

    /*
     * Avoid adding the same link multiple times if the script is executed again.
     */
    const escapedCssPath = cssHtmlPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const existingLinkPattern = new RegExp(
        `<link\\b[^>]*href=["']${escapedCssPath}["'][^>]*>`,
        "i",
    );

    if (existingLinkPattern.test(html)) {
        return html;
    }

    /*
     * Insert the link before </head>.
     */
    if (/<\/head>/i.test(html)) {
        return html.replace(
            /<\/head>/i,
            `  ${stylesheetLink}\n</head>`,
        );
    }

    /*
     * Fallback if the document does not contain a <head>.
     */
    if (/<html\b[^>]*>/i.test(html)) {
        return html.replace(
            /<html\b([^>]*)>/i,
            `<html$1>\n<head>\n  ${stylesheetLink}\n</head>`,
        );
    }

    /*
     * Final fallback for HTML fragments.
     */
    return `${stylesheetLink}\n${html}`;
}

function processHtml() {
    if (!fs.existsSync(inputFile)) {
        throw new Error(`Input HTML file not found: ${inputFile}`);
    }

    const outputDirectory = path.dirname(outputFile);
    const cssDirectory = path.dirname(cssFile);

    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.mkdirSync(cssDirectory, { recursive: true });

    /*
     * This directory should contain only generated images.
     */
    fs.rmSync(imagesDirectory, {
        recursive: true,
        force: true,
    });

    fs.mkdirSync(imagesDirectory, {
        recursive: true,
    });

    let html = fs.readFileSync(inputFile, "utf8");

    const savedImages = new Map();

    const stats = {
        totalImageOccurrences: 0,
        uniqueImages: 0,
    };

    /*
     * Extract all <style> elements first.
     */
    const styleResult = extractStyleElements(html);

    html = styleResult.html;
    let css = styleResult.css;

    /*
     * Extract Base64 images from both the HTML and the extracted CSS.
     */
    html = extractBase64Images(html, savedImages, stats);
    css = extractBase64Images(css, savedImages, stats);

    /*
     * Write the CSS file only when CSS was found.
     */
    if (css.trim()) {
        fs.writeFileSync(cssFile, `${css.trim()}\n`, "utf8");
        html = addStylesheetLink(html);
    } else {
        /*
         * Remove an obsolete generated CSS file from an earlier run.
         */
        fs.rmSync(cssFile, {
            force: true,
        });
    }

    fs.writeFileSync(outputFile, html, "utf8");

    console.log("");
    console.log("HTML processing completed.");
    console.log(
        `Style elements extracted: ${styleResult.numberOfStyleElements}`,
    );
    console.log(`Image occurrences found: ${stats.totalImageOccurrences}`);
    console.log(`Unique images saved: ${stats.uniqueImages}`);
    console.log(`HTML file: ${outputFile}`);

    if (css.trim()) {
        console.log(`CSS file: ${cssFile}`);
    }

    console.log(`Images directory: ${imagesDirectory}`);
}

try {
    processHtml();
} catch (error) {
    console.error("");
    console.error("HTML processing failed.");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}