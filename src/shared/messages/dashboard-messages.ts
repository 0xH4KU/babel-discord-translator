function rangeMessage(field: string, min: number, max: number): string {
    return `${field} must be ${min}–${max}`;
}

function nonNegativeMessage(field: string): string {
    return `${field} must be >= 0`;
}

export const dashboardMessages = {
    auth: {
        tooManyLoginAttempts: 'Too many login attempts, please try again later',
        wrongPassword: 'Wrong password',
        unauthorized: 'Unauthorized',
        invalidCsrfToken: 'Invalid CSRF token',
    },
    validation: {
        cooldownSeconds: rangeMessage('cooldownSeconds', 1, 300),
        cacheMaxSize: rangeMessage('cacheMaxSize', 10, 100000),
        maxInputLength: rangeMessage('maxInputLength', 100, 10000),
        maxOutputTokens: rangeMessage('maxOutputTokens', 100, 8192),
        dailyBudgetUsd: nonNegativeMessage('dailyBudgetUsd'),
        inputPricePerMillion: nonNegativeMessage('inputPricePerMillion'),
        outputPricePerMillion: nonNegativeMessage('outputPricePerMillion'),
    },
    userPreferences: {
        notFound: 'User not found',
    },
    translationTest: {
        textRequired: 'Text is required',
    },
};
