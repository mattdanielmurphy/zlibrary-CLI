import fs from 'fs';
import path from 'path';

/**
 * Removes all punctuation and special characters for better matching
 * @param {string} str - String to normalize
 * @returns {string} normalized string with punctuation removed
 */
function removePunctuation(str) {
    if (!str) return str;
    // Remove specific punctuation, including hyphens, and normalize whitespace
    return str.replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Calculates similarity between two strings using Levenshtein distance
 * @param {string} str1 
 * @param {string} str2 
 * @returns {number} similarity score between 0 and 1
 */
function stringSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    
    // Remove punctuation and normalize before comparison
    const s1 = removePunctuation(str1).toLowerCase().trim();
    const s2 = removePunctuation(str2).toLowerCase().trim();
    
    if (s1 === s2) return 1;
    
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    
    if (longer.length === 0) return 1;
    
    const distance = levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
}

/**
 * Smart author name matching that handles different formats
 * @param {string} author1 
 * @param {string} author2 
 * @returns {number} similarity score between 0 and 1
 */
function authorSimilarity(author1, author2) {
    if (!author1 || !author2) return 0;
    
    // Remove punctuation from both author names
    const normAuthor1 = removePunctuation(author1);
    const normAuthor2 = removePunctuation(author2);
    
    // Direct comparison first
    const directSim = stringSimilarity(normAuthor1, normAuthor2);
    
    // Try flipping "Last, First" to "First Last" format
    let flippedSim1 = 0;
    let flippedSim2 = 0;
    
    // Check if author1 is in "Last, First" format
    if (normAuthor1.includes(',')) {
        const parts = normAuthor1.split(',').map(p => p.trim());
        if (parts.length === 2) {
            const flipped = `${parts[1]} ${parts[0]}`;
            flippedSim1 = stringSimilarity(flipped, normAuthor2);
        }
    }
    
    // Check if author2 is in "Last, First" format
    if (normAuthor2.includes(',')) {
        const parts = normAuthor2.split(',').map(p => p.trim());
        if (parts.length === 2) {
            const flipped = `${parts[1]} ${parts[0]}`;
            flippedSim2 = stringSimilarity(normAuthor1, flipped);
        }
    }
    
    // Try flipping "First Last" to "Last First" format (for cases like "Fiona Lowe" vs "Lowe Fiona")
    let reversedSim1 = 0;
    let reversedSim2 = 0;
    
    // Check if author1 has two words (First Last)
    const words1 = normAuthor1.trim().split(/\s+/);
    if (words1.length === 2 && !normAuthor1.includes(',')) {
        const reversed = `${words1[1]} ${words1[0]}`;
        reversedSim1 = stringSimilarity(reversed, normAuthor2);
    }
    
    // Check if author2 has two words (First Last)
    const words2 = normAuthor2.trim().split(/\s+/);
    if (words2.length === 2 && !normAuthor2.includes(',')) {
        const reversed = `${words2[1]} ${words2[0]}`;
        reversedSim2 = stringSimilarity(normAuthor1, reversed);
    }
    
    
    // Return the best similarity score
    return Math.max(directSim, flippedSim1, flippedSim2, reversedSim1, reversedSim2);
}

/**
 * Calculates Levenshtein distance between two strings
 * @param {string} str1 
 * @param {string} str2 
 * @returns {number} edit distance
 */
function levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    
    return matrix[str2.length][str1.length];
}

/**
 * Checks if a book from search results matches the target book
 * @param {object} searchBook - Book from API search results
 * @param {object} targetBook - Book from JSON input
 * @param {number} threshold - Minimum similarity threshold (0-1)
 * @returns {boolean} whether the book matches
 */
function isBookMatch(searchBook, targetBook, threshold = 0.75) {
    const titleSimilarity = stringSimilarity(searchBook.title, targetBook.title);
    const authorSimilarity = stringSimilarity(searchBook.author, targetBook.author);
    
    // Both title and author must meet threshold
    return titleSimilarity >= threshold && authorSimilarity >= threshold;
}

/**
 * Finds the best matching book from search results
 * @param {array} searchResults - Array of books from API search
 * @param {object} targetBook - Target book to match (with title, subtitle optional, author)
 * @param {number} threshold - Minimum similarity threshold
 * @returns {object|null} best matching book or null if no good match
 */
function findBestMatch(searchResults, targetBook, threshold = 0.75) {
    let bestMatch = null;
    let bestScore = 0;
    
    for (const book of searchResults) {
        const titleSimilarity = stringSimilarity(book.title, targetBook.title);
        const authorSim = authorSimilarity(book.author, targetBook.author);
        
        let combinedScore;
        
        // If target book has subtitle, try matching with full title (title + subtitle)
        if (targetBook.subtitle && targetBook.subtitle.trim()) {
            const fullTargetTitle = `${targetBook.title} ${targetBook.subtitle}`.trim();
            const fullTitleSimilarity = stringSimilarity(book.title, fullTargetTitle);
            
            // Use the better of title-only or full-title matching
            const bestTitleMatch = Math.max(titleSimilarity, fullTitleSimilarity);
            combinedScore = (bestTitleMatch + authorSim) / 2;
        } else {
            // Standard title + author matching
            combinedScore = (titleSimilarity + authorSim) / 2;
        }
        
        if (combinedScore >= threshold && combinedScore > bestScore) {
            bestMatch = book;
            bestScore = combinedScore;
        }
    }
    
    return bestMatch;
}

/**
 * Reads and parses JSON file with books list
 * @param {string} filePath 
 * @returns {array} array of book objects
 */
function readBooksFromJSON(filePath) {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        const books = JSON.parse(data);
        
        if (!Array.isArray(books)) {
            throw new Error('JSON file must contain an array of books');
        }
        
        // Validate each book has title and author (subtitle is optional)
        for (let i = 0; i < books.length; i++) {
            if (!books[i].title || !books[i].author) {
                throw new Error(`Book at index ${i} missing title or author`);
            }
        }
        
        return books;
    } catch (error) {
        throw new Error(`Failed to read books JSON: ${error.message}`);
    }
}

/**
 * Saves array of books to JSON file
 * @param {string} filePath 
 * @param {array} books 
 */
function saveBooksToJSON(filePath, books) {
    try {
        const data = JSON.stringify(books, null, 2);
        fs.writeFileSync(filePath, data, 'utf8');
    } catch (error) {
        throw new Error(`Failed to save books JSON: ${error.message}`);
    }
}

/**
 * Creates a delay (sleep) for the specified number of milliseconds
 * @param {number} ms - milliseconds to wait
 * @returns {Promise} promise that resolves after delay
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Cleans filename to be filesystem-safe
 * @param {string} filename 
 * @returns {string} cleaned filename
 */
function cleanFilename(filename) {
    return filename.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Finds the best matching book with detailed debugging info
 * @param {array} searchResults - Array of books from API search
 * @param {object} targetBook - Target book to match (with title, subtitle optional, author)
 * @param {number} threshold - Minimum similarity threshold
 * @returns {object} {match: book|null, bestScore: number, allScores: array}
 */
function findBestMatchWithDebug(searchResults, targetBook, threshold = 0.75) {
    let bestMatch = null;
    let bestScore = 0;
    const allScores = [];
    
    for (const book of searchResults) {
        const titleSimilarity = stringSimilarity(book.title, targetBook.title);
        const authorSim = authorSimilarity(book.author, targetBook.author);
        
        let combinedScore;
        let titleUsed = targetBook.title;
        
        // If target book has subtitle, try matching with full title (title + subtitle)
        if (targetBook.subtitle && targetBook.subtitle.trim()) {
            const fullTargetTitle = `${targetBook.title} ${targetBook.subtitle}`.trim();
            const fullTitleSimilarity = stringSimilarity(book.title, fullTargetTitle);
            
            // Use the better of title-only or full-title matching
            if (fullTitleSimilarity > titleSimilarity) {
                combinedScore = (fullTitleSimilarity + authorSim) / 2;
                titleUsed = fullTargetTitle;
            } else {
                combinedScore = (titleSimilarity + authorSim) / 2;
            }
        } else {
            // Standard title + author matching
            combinedScore = (titleSimilarity + authorSim) / 2;
        }
        
        allScores.push({
            book: book,
            titleScore: titleSimilarity,
            authorScore: authorSim,
            combinedScore: combinedScore,
            titleUsed: titleUsed
        });
        
        if (combinedScore >= threshold && combinedScore > bestScore) {
            bestMatch = book;
            bestScore = combinedScore;
        }
    }
    
    // Sort all scores by combined score descending
    allScores.sort((a, b) => b.combinedScore - a.combinedScore);
    
    return {
        match: bestMatch,
        bestScore: bestScore,
        allScores: allScores
    };
}

export default {
    stringSimilarity,
    isBookMatch,
    findBestMatch,
    findBestMatchWithDebug,
    readBooksFromJSON,
    saveBooksToJSON,
    sleep,
    cleanFilename,
    removePunctuation
};
