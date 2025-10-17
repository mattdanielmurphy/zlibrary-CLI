import Enquirer from 'enquirer';
import api from './api.js';
import batchUtils from './batch-utils.js';
import configs from './config.js';
import fs from 'fs';
import path from 'path';
import readline from 'readline' // Make sure to require readline at the top of your file

// Path to downloaded books tracking file
const DOWNLOADED_BOOKS_FILE = path.join(process.cwd(), 'downloadedBooks.json');
const FAILED_DOWNLOADS_FILE = path.join(process.cwd(), 'failedDownloads.json');

/**
 * Main batch download function
 * @param {string} jsonFilePath - Path to JSON file with books list
 */
async function batchDownload(jsonFilePath) {
    console.clear();
    console.log('Starting batch download process...\n');
    
    try {
        // Read books from JSON file
        console.log(`Reading books from: ${jsonFilePath}`);
        const targetBooks = batchUtils.readBooksFromJSON(jsonFilePath);
        console.log(`Found ${targetBooks.length} books to download`);
        
        // Load already downloaded books
        const alreadyDownloadedBooks = loadDownloadedBooks();
        console.log(`Found ${alreadyDownloadedBooks.length} already downloaded books`);
        
        // Filter out already downloaded books
        const booksToDownload = targetBooks.filter(book => !isBookAlreadyDownloaded(book, alreadyDownloadedBooks));
        console.log(`Books to download: ${booksToDownload.length} (${targetBooks.length - booksToDownload.length} already downloaded)\n`);
        
        // Initialize tracking arrays
        const downloadedBooks = [];
        const notFoundBooks = [];
        const failedDownloads = [];

        // Flag to indicate if we hit the daily limit
        let dailyLimitHit = false;
        
        // Process each book
        for (let i = 0; i < booksToDownload.length; i++) {
             // If the daily limit was hit in a previous iteration, we should stop processing.
            // This loop condition also serves as the check.
            if (dailyLimitHit) {
                break; // Exit the loop if limit was hit
            }
            
            const targetBook = booksToDownload[i];
            const displayTitle = targetBook.subtitle ? 
                `"${targetBook.title}: ${targetBook.subtitle}"` : 
                `"${targetBook.title}"`;
            console.log(`\n[${i + 1}/${booksToDownload.length}] Processing: ${displayTitle} by ${targetBook.author}`);
            
            try {
                // Search for the book
                const searchQuery = `${batchUtils.removePunctuation(targetBook.title)} ${batchUtils.removePunctuation(targetBook.author)}`
                console.log(`  🔍 Searching for: "${searchQuery}"`);
                const searchResults = await searchForBook(searchQuery);
                
                if (!searchResults || !searchResults.books || searchResults.books.length === 0) {
                    console.log('  ❌ No search results found');
                    const failureInfo = {
                        title: targetBook.title,
                        subtitle: targetBook.subtitle,
                        author: targetBook.author,
                        reason: 'No search results',
                        searchQuery,
                        searchResults: []
                    };
                    notFoundBooks.push(failureInfo);
                    saveFailedDownload(failureInfo);
                } else {
                    console.log(`  📊 Found ${searchResults.books.length} search results`);
                    
                    // Try to find and download a book with EPUB format
                    const downloadResult = await tryDownloadWithEpubFallback(searchResults.books, targetBook);
                    
                    if (downloadResult.success) {
                        downloadedBooks.push(downloadResult.bookInfo);
                        // Save to downloaded books file
                        saveDownloadedBook(downloadResult.bookInfo);
                    } else {
                        console.log(`  ❌ ${downloadResult.reason}`);
                        const failureInfo = {
                            title: targetBook.title,
                            subtitle: targetBook.subtitle,
                            author: targetBook.author,
                            reason: downloadResult.reason,
                            searchQuery,
                            searchResults: searchResults.books.map(book => ({
                                title: book.title,
                                author: book.author,
                                id: book.id,
                                hash: book.hash,
                                year: book.year
                            })),
                            bestScore: downloadResult.bestScore,
                            foundBook: downloadResult.foundBook,
                            format: downloadResult.format,
                            candidates: downloadResult.candidates || []
                        };
                        
                        if (downloadResult.reason.includes('No close match')) {
                            notFoundBooks.push(failureInfo);
                        } else {
                            failedDownloads.push(failureInfo);
                        }
                        saveFailedDownload(failureInfo);
                    }
                }
                
            } catch (error) {
                console.error('  🛑 An error occurred:', error); // Keep this for debugging

                const errorMessage = typeof error === 'string' ? error : (error.message || JSON.stringify(error));

                if (errorMessage.includes('DAILY_LIMIT_REACHED') || errorMessage.includes('daily limit') || errorMessage.includes('429 Too Many Requests')) {
                    console.log('\n' + '='.repeat(60));
                    console.log('🚫 DAILY DOWNLOAD LIMIT REACHED');
                    console.log('='.repeat(60));
                    console.log('You have reached your daily download limit.');
                    console.log('The script will stop processing books here.');
                    console.log('Please wait for the limit to reset or consider upgrading your account.');
                    console.log('\nPress Ctrl+C to exit.');
                    console.log('='.repeat(60));

                    // Create a readline interface to keep the process open,
                    // but don't actually wait for input. Just by creating it,
                    // Node's event loop will remain active.
                    const rl = readline.createInterface({
                        input: process.stdin,
                        output: process.stdout,
                        terminal: false // Important: set to false to not prompt for input
                    });

                    // Keep a promise pending indefinitely, but use rl to ensure the process stays alive
                    await new Promise(resolve => {
                        // This promise will never resolve, effectively pausing the async execution here.
                        // The `rl` interface keeps the Node.js process running.
                    });

                }

                console.log(`  ❌ Error processing book: ${error.message}`);
                failedDownloads.push({
                    ...targetBook,
                    reason: `Processing error: ${error.message}`
                });
            } finally {
                // Add delay between downloads (except for last item)
                // Note: API calls now have built-in 0.5s rate limiting
                if (i < booksToDownload.length - 1) {
                    process.stdout.write('  ⏳ Waiting 0.5 seconds before next book...\r');
                    await batchUtils.sleep(500);
                    process.stdout.write('  ✓ Ready for next book!\n');
                }
            }
        }
        
        // Generate summary report
        await generateReport(downloadedBooks, notFoundBooks, failedDownloads, jsonFilePath, targetBooks.length - booksToDownload.length);
        
    } catch (error) {
        console.log(`\nFatal error: ${error.message}`);
        return false;
    }
}

/**
 * Load already downloaded books from JSON file
 * @returns {array} array of downloaded book objects
 */
function loadDownloadedBooks() {
    try {
        if (fs.existsSync(DOWNLOADED_BOOKS_FILE)) {
            const data = fs.readFileSync(DOWNLOADED_BOOKS_FILE, 'utf8');
            return JSON.parse(data);
        }
        return [];
    } catch (error) {
        console.log(`Warning: Could not load downloaded books file: ${error.message}`);
        return [];
    }
}

/**
 * Check if a book is already downloaded
 * @param {object} book - Book to check
 * @param {array} downloadedBooks - Array of already downloaded books
 * @returns {boolean} true if already downloaded
 */
function isBookAlreadyDownloaded(book, downloadedBooks) {
    return downloadedBooks.some(downloaded => {
        const titleMatch = batchUtils.stringSimilarity(book.title, downloaded.title) >= 0.9;
        const authorMatch = batchUtils.stringSimilarity(book.author, downloaded.author) >= 0.9;
        return titleMatch && authorMatch;
    });
}

/**
 * Save a successfully downloaded book to the downloaded books file
 * @param {object} bookInfo - Book information to save
 */
function saveDownloadedBook(bookInfo) {
    try {
        const downloadedBooks = loadDownloadedBooks();
        downloadedBooks.push({
            title: bookInfo.original.title,
            subtitle: bookInfo.original.subtitle,
            author: bookInfo.original.author,
            downloadedAt: new Date().toISOString(),
            filename: bookInfo.downloaded.filename,
            downloadedTitle: bookInfo.downloaded.title,
            downloadedAuthor: bookInfo.downloaded.author,
            format: bookInfo.downloaded.format
        });
        
        const data = JSON.stringify(downloadedBooks, null, 2);
        fs.writeFileSync(DOWNLOADED_BOOKS_FILE, data, 'utf8');
    } catch (error) {
        console.log(`Warning: Could not save downloaded book: ${error.message}`);
    }
}

/**
 * Save detailed failure information to failed downloads file
 * @param {object} failureInfo - Detailed failure information
 */
function saveFailedDownload(failureInfo) {
    try {
        let failedDownloads = [];
        if (fs.existsSync(FAILED_DOWNLOADS_FILE)) {
            const data = fs.readFileSync(FAILED_DOWNLOADS_FILE, 'utf8');
            failedDownloads = JSON.parse(data);
        }
        
        failedDownloads.push({
            ...failureInfo,
            failedAt: new Date().toISOString()
        });
        
        const data = JSON.stringify(failedDownloads, null, 2);
        fs.writeFileSync(FAILED_DOWNLOADS_FILE, data, 'utf8');
    } catch (error) {
        console.log(`Warning: Could not save failed download: ${error.message}`);
    }
}

/**
 * Try to download a book with EPUB priority - tries multiple candidates until EPUB is found, MOBI as last resort
 * @param {array} searchResults - Array of search result books
 * @param {object} targetBook - Target book to match
 * @returns {object} {success: boolean, reason: string, bookInfo?: object, ...}
 */
async function tryDownloadWithEpubFallback(searchResults, targetBook) {
    // Find best matches with detailed scoring
    const bestMatch = batchUtils.findBestMatchWithDebug(searchResults, targetBook, 0.75);
    
    if (!bestMatch.match) {
        console.log(`  ❌ No close enough match found. Best score: ${bestMatch.bestScore?.toFixed(3) || 'N/A'}`);
        console.log(`  📋 Top 3 candidates:`);
        bestMatch.allScores?.slice(0, 3).forEach(score => {
            console.log(`    - "${score.book.title}" by ${score.book.author} (score: ${score.combinedScore.toFixed(3)})`);
            console.log(`      Title: ${score.titleScore.toFixed(3)}, Author: ${score.authorScore.toFixed(3)}`);
        });
        return {
            success: false,
            reason: 'No close match found',
            bestScore: bestMatch.bestScore,
            candidates: bestMatch.allScores?.slice(0, 5).map(score => ({
                title: score.book.title,
                author: score.book.author,
                id: score.book.id,
                hash: score.book.hash,
                year: score.book.year,
                combinedScore: score.combinedScore,
                titleScore: score.titleScore,
                authorScore: score.authorScore
            })) || []
        };
    }
    
    // Try candidates in order of match quality, prioritizing EPUB
    const candidates = bestMatch.allScores
        .filter(score => score.combinedScore >= 0.75)
        .sort((a, b) => b.combinedScore - a.combinedScore);
    
    let epubFound = false;
    let mobiCandidates = [];
    
    // First pass: Look for EPUB format
    for (let i = 0; i < Math.min(candidates.length, 5); i++) {
        const candidate = candidates[i].book;
        console.log(`  🔍 Trying candidate ${i + 1}: "${candidate.title}" by ${candidate.author} (score: ${candidates[i].combinedScore.toFixed(3)})`);
        
        try {
            const formatInfo = await getBookFormat(candidate.id, candidate.hash);
            
            if (!formatInfo) {
                console.log(`    ❌ No EPUB or MOBI format available`);
                continue;
            }
            
            if (formatInfo.extension === 'epub') {
                console.log(`    ✓ Found EPUB format`);
                const downloadSuccess = await downloadBook(candidate, formatInfo, targetBook);
                
                if (downloadSuccess) {
                    return {
                        success: true,
                        bookInfo: {
                            original: targetBook,
                            downloaded: {
                                title: candidate.title,
                                author: candidate.author,
                                format: formatInfo.extension,
                                filename: formatInfo.filename
                            }
                        }
                    };
                } else {
                    console.log(`    ❌ EPUB download failed`);
                    continue;
                }
            } else if (formatInfo.extension === 'mobi') {
                console.log(`    📱 Found MOBI format (saving for fallback)`);
                mobiCandidates.push({ candidate, formatInfo, score: candidates[i].combinedScore });
            }
        } catch (error) {
            // Check for daily limit error
            if (error.message.includes('DAILY_LIMIT_REACHED')) {
                throw error; // Re-throw to stop the entire batch process
            }
            console.log(`    ❌ Error with candidate: ${error.message}`);
            continue;
        }
    }
    
    // Second pass: If no EPUB found, try MOBI candidates
    if (mobiCandidates.length > 0) {
        
        // Sort MOBI candidates by match score
        mobiCandidates.sort((a, b) => b.score - a.score);
        
        for (let i = 0; i < mobiCandidates.length; i++) {
            const { candidate, formatInfo } = mobiCandidates[i];
            console.log(`  🔍 Trying MOBI candidate ${i + 1}: "${candidate.title}" by ${candidate.author}`);
            
            try {
                const downloadSuccess = await downloadBook(candidate, formatInfo, targetBook);
                
                if (downloadSuccess) {
                    return {
                        success: true,
                        bookInfo: {
                            original: targetBook,
                            downloaded: {
                                title: candidate.title,
                                author: candidate.author,
                                format: formatInfo.extension,
                                filename: formatInfo.filename
                            }
                        }
                    };
                } else {
                    console.log(`    ❌ MOBI download failed`);
                    continue;
                }
            } catch (error) {
                // Check for daily limit error
                if (error.message.includes('DAILY_LIMIT_REACHED')) {
                    throw error; // Re-throw to stop the entire batch process
                }
                console.log(`    ❌ Error with MOBI candidate: ${error.message}`);
                continue;
            }
        }
    }
    
    return {
        success: false,
        reason: 'No EPUB or MOBI format available or download failed for all candidates',
        foundBook: `"${bestMatch.match.title}" by ${bestMatch.match.author}`,
        format: 'unknown',
        candidates: candidates.map(score => ({
            title: score.book.title,
            author: score.book.author,
            id: score.book.id,
            hash: score.book.hash,
            year: score.book.year,
            combinedScore: score.combinedScore,
            titleScore: score.titleScore,
            authorScore: score.authorScore
        }))
    };
}

/**
 * Get book format information (EPUB or MOBI)
 * @param {number} id - Book ID
 * @param {string} hash - Book hash
 * @returns {object|null} format info or null if not available
 */
async function getBookFormat(id, hash) {
    try {
        const response = await api.getDetailedFormatInfo(id, hash);
        return response;
    } catch (error) {
        // Check for daily limit error and re-throw it
        if (error.message.includes('DAILY_LIMIT_REACHED')) {
            throw error;
        }
        console.log(`    ❌ Error getting book format: ${error.message}`);
        return null;
    }
}

/**
 * Search for a book using title + author for precise results
 * @param {string} query - Search query
 * @returns {object|null} search results
 */
async function searchForBook(query) {
    // Search by title + author for more precise results
    const searchData = {
        message: query,
        yearFrom: '0',
        yearTo: String(new Date().getFullYear()),
        languages: ['english'],
        extensions: ['epub', 'mobi'],
        limit: 20,
        order: 'popular'
    };
    
    return await api.searchBooks(searchData);
}

/**
 * Download a book file
 * @param {object} bookInfo - Book information from search
 * @param {object} formatInfo - Download format information
 * @param {object} originalBook - Original book from JSON
 * @returns {boolean} success status
 */
async function downloadBook(bookInfo, formatInfo, originalBook) {
    try {
        // Download the file
        const fileData = await api.downloadFile(formatInfo.downloadLink);
        
        // Ensure download directory exists
        const downloadPath = configs.getDownloadPath();
        if (!fs.existsSync(downloadPath)) {
            fs.mkdirSync(downloadPath, { recursive: true });
        }
        
        // Create clean filename
        const cleanTitle = batchUtils.cleanFilename(originalBook.title);
        const cleanAuthor = batchUtils.cleanFilename(originalBook.author);
        const filename = `${cleanTitle} - ${cleanAuthor}.${formatInfo.extension}`;
        const filePath = path.join(downloadPath, filename);
        
        // Save file
        fs.writeFileSync(filePath, fileData);
        
        return true;
        
    } catch (error) {
        // Check for daily limit error during download
        if (error.message.includes('DAILY_LIMIT_REACHED')) {
            throw error; // Re-throw to be caught by the main error handler
        }
        console.log(`  ❌ Download error: ${error.message}`);
        return false;
    }
}

/**
 * Generate summary report and save unmatched books
 * @param {array} downloaded - Successfully downloaded books
 * @param {array} notFound - Books that couldn't be found/matched
 * @param {array} failed - Books that failed to download
 * @param {string} originalFilePath - Path to original JSON file
 * @param {number} alreadyDownloaded - Number of books already downloaded
 */
async function generateReport(downloaded, notFound, failed, originalFilePath, alreadyDownloaded = 0) {
    console.log('\n' + '='.repeat(60));
    console.log('BATCH DOWNLOAD SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Successfully downloaded: ${downloaded.length}`);
    console.log(`📚 Already downloaded (skipped): ${alreadyDownloaded}`);
    console.log(`❌ Not found/no match: ${notFound.length}`);
    console.log(`⚠️  Failed downloads: ${failed.length}`);
    
    // Combine not found and failed for the undownloaded list
    const undownloaded = [...notFound, ...failed].map(book => {
        const result = {
            title: book.title,
            author: book.author
        };
        // Preserve subtitle if it exists
        if (book.subtitle) {
            result.subtitle = book.subtitle;
        }
        return result;
    });
    
    if (undownloaded.length > 0) {
        // Save undownloaded books to JSON file
        const dir = path.dirname(originalFilePath);
        const baseName = path.basename(originalFilePath, path.extname(originalFilePath));
        const undownloadedFile = path.join(dir, `${baseName}_undownloaded.json`);
        
        batchUtils.saveBooksToJSON(undownloadedFile, undownloaded);
        console.log(`\n📝 Undownloaded books saved to: ${undownloadedFile}`);
    }
    
    // Save detailed log with reasons
    if (notFound.length > 0 || failed.length > 0) {
        const dir = path.dirname(originalFilePath);
        const baseName = path.basename(originalFilePath, path.extname(originalFilePath));
        const logFile = path.join(dir, `${baseName}_log.json`);
        
        const detailedLog = {
            summary: {
                total: downloaded.length + notFound.length + failed.length,
                downloaded: downloaded.length,
                notFound: notFound.length,
                failed: failed.length
            },
            downloaded: downloaded,
            notFound: notFound,
            failed: failed
        };
        
        batchUtils.saveBooksToJSON(logFile, detailedLog);
        console.log(`📊 Detailed log saved to: ${logFile}`);
    }
    
    console.log('\nBatch download complete!');
}

export default { batchDownload };