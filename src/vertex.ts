/**
 * Generate the Vertex AI API URL for a given project, location, and model.
 */
export function getVertexAiUrl(project: string, location: string, model: string): string {
    const baseUrl =
        location === 'global'
            ? 'https://aiplatform.googleapis.com'
            : `https://${location}-aiplatform.googleapis.com`;
    return `${baseUrl}/v1beta1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
}
