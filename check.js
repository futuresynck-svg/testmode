const fs = require('fs');
const code = fs.readFileSync('script.js', 'utf8');

let line = 1;
let stack = [];
let inString = false;
let stringChar = '';
let inSingleLineComment = false;
let inMultiLineComment = false;

for (let i = 0; i < code.length; i++) {
    const c = code[i];
    const next_c = code[i+1];

    if (c === '\n') {
        line++;
        if (inSingleLineComment) inSingleLineComment = false;
        continue;
    }

    if (inSingleLineComment) continue;

    if (inMultiLineComment) {
        if (c === '*' && next_c === '/') {
            inMultiLineComment = false;
            i++;
        }
        continue;
    }

    if (inString) {
        if (c === '\\') {
            i++; // skip escaped char
            continue;
        }
        if (c === stringChar) {
            inString = false;
        }
        continue;
    }

    if (c === '/' && next_c === '/') {
        inSingleLineComment = true;
        i++;
        continue;
    }
    
    if (c === '/' && next_c === '*') {
        inMultiLineComment = true;
        i++;
        continue;
    }

    if (c === '"' || c === "'" || c === '`') {
        inString = true;
        stringChar = c;
        continue;
    }

    if (c === '{' || c === '(' || c === '[') {
        stack.push({ char: c, line });
    } else if (c === '}' || c === ')' || c === ']') {
        if (stack.length === 0) {
            console.log(`Extra closing ${c} at line ${line}`);
            process.exit(1);
        }
        const top = stack.pop();
        const expected = c === '}' ? '{' : c === ')' ? '(' : '[';
        if (top.char !== expected) {
            console.log(`Mismatched closing ${c} at line ${line}. Expected to close ${top.char} from line ${top.line}`);
            process.exit(1);
        }
    }
}

if (stack.length > 0) {
    console.log(`Unclosed symbols:`, stack);
} else {
    console.log('All braces matched!');
}
