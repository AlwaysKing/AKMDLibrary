export const uploadApi = {
  uploadWithProgress: async (
    file: File,
    options?: {
      onProgress?: (progress: number) => void;
      pageId?: string;
      spaceSlug?: string;
    }
  ): Promise<{ path: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    if (options?.pageId) {
      formData.append('page_id', options.pageId);
    }
    if (options?.spaceSlug) {
      formData.append('space_slug', options.spaceSlug);
    }

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (event) => {
        if (!event.lengthComputable) return;
        const progress = Math.round((event.loaded / event.total) * 100);
        options?.onProgress?.(progress);
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (error) {
            reject(error);
          }
        } else {
          reject(new Error('Upload failed'));
        }
      });

      xhr.addEventListener('error', () => reject(new Error('Upload failed')));
      xhr.open('POST', '/api/upload');

      const token = localStorage.getItem('token');
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      xhr.send(formData);
    });
  },

  upload: async (
    file: File,
    options?: { pageId?: string; spaceSlug?: string }
  ): Promise<{ path: string }> => {
    return uploadApi.uploadWithProgress(file, options);
  },
};
