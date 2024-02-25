package com.beskar.media.common;

import org.springframework.http.MediaType;

/**
 * Contains all the constants of the service.
 */
public class MediaConstants {

    public static final String[] ALLOWED_MEDIA_TYPES = {
        MediaType.IMAGE_PNG_VALUE,
        MediaType.IMAGE_JPEG_VALUE,
        MediaType.IMAGE_GIF_VALUE
    };
}
