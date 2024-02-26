package com.beskar.media.services;

import org.springframework.core.io.Resource;
import org.springframework.web.multipart.MultipartFile;

/**
 * Storage service to save media files.
 */
public interface StorageService {

    /**
     * Initialize the storage.
     */
    public void init();

    /**
     * Save file to storage.
     *
     * @param file document to be saved.
     * @return file name.
     */
    public String save(MultipartFile file);

    /**
     * Loads file.
     *
     * @param filename file name of the file to be loaded.
     * @return io stream containing file data.
     */
    public Resource load(String filename);
    
}
