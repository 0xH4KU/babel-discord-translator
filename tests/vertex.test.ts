import { describe, it, expect } from 'vitest';
import { getVertexAiUrl } from '../src/vertex.js';

describe('getVertexAiUrl', () => {
    it('should return global URL when location is "global"', () => {
        const url = getVertexAiUrl('my-project', 'global', 'gemini-1.5-flash');
        expect(url).toBe('https://aiplatform.googleapis.com/v1beta1/projects/my-project/locations/global/publishers/google/models/gemini-1.5-flash:generateContent');
    });

    it('should return regional URL when location is not "global"', () => {
        const url = getVertexAiUrl('my-project', 'us-central1', 'gemini-1.5-flash');
        expect(url).toBe('https://us-central1-aiplatform.googleapis.com/v1beta1/projects/my-project/locations/us-central1/publishers/google/models/gemini-1.5-flash:generateContent');
    });

    it('should correctly handle different models', () => {
        const url = getVertexAiUrl('my-project', 'global', 'gemini-pro');
        expect(url).toContain('/models/gemini-pro:generateContent');
    });

    it('should correctly handle different projects', () => {
        const url = getVertexAiUrl('another-project', 'global', 'gemini-1.5-flash');
        expect(url).toContain('/projects/another-project/');
    });
});
