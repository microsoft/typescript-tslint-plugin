import { normalize } from 'path';
import * as tslint from 'tslint'; // this is a dev dependency only

/**
 * Filter failures for the given document
 */
export function filterProblemsForFile(
    filePath: string,
    failures: tslint.RuleFailure[],
): tslint.RuleFailure[] {
    const normalizedPath = normalize(filePath);
    // we only show diagnostics targetting this open document, some tslint rule return diagnostics for other documents/files
    const normalizedFiles = new Map<string, string>();
    return failures.filter(each => {
        const fileName = each.getFileName();
        if (!normalizedFiles.has(fileName)) {
            normalizedFiles.set(fileName, normalize(fileName));
        }
        return normalizedFiles.get(fileName) === normalizedPath;
    });
}

export function getReplacements(fix: tslint.Fix | undefined): tslint.Replacement[] {
    let replacements: tslint.Replacement[] | null = null;
    // in tslint4 a Fix has a replacement property with the Replacements
    if ((fix as any).replacements) {
        // tslint4
        replacements = (fix as any).replacements;
    } else {
        // in tslint 5 a Fix is a Replacement | Replacement[]
        if (!Array.isArray(fix)) {
            replacements = [fix as any];
        } else {
            replacements = fix;
        }
    }
    return replacements || [];
}

function getReplacement(failure: tslint.RuleFailure, at: number): tslint.Replacement {
    return getReplacements(failure.getFix())[at];
}

export function sortFailures(failures: tslint.RuleFailure[]): tslint.RuleFailure[] {
    // The failures.replacements are sorted by position, we sort on the position of the first replacement
    return failures.sort((a, b) => {
        return getReplacement(a, 0).start - getReplacement(b, 0).start;
    });
}

export function getNonOverlappingReplacements(failures: tslint.RuleFailure[]): tslint.Replacement[] {
    function overlaps(a: tslint.Replacement, b: tslint.Replacement): boolean {
        return a.end >= b.start;
    }

    const sortedFailures = sortFailures(failures);
    const nonOverlapping: tslint.Replacement[] = [];
    for (let i = 0; i < sortedFailures.length; i++) {
        const replacements = getReplacements(sortedFailures[i].getFix());
        if (i === 0 || !overlaps(nonOverlapping[nonOverlapping.length - 1], replacements[0])) {
            nonOverlapping.push(...replacements);
        }
    }
    return nonOverlapping;
}
