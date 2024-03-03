package com.beskar.media.controllers;

import com.beskar.media.common.RestResponse;
import com.beskar.media.dto.FileDto;
import com.beskar.media.services.StorageService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * Media controller.
 */

@RestController
@RequestMapping("/media")
public class Media {

    private static final Logger logger = LoggerFactory.getLogger(Media.class);

    private final String attachement = "attachement; filename=\"";

    @Autowired
    StorageService storageService;

    @RequestMapping(method = RequestMethod.POST, consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    ResponseEntity<RestResponse> upload(@RequestParam(name = "file") MultipartFile file) {
        logger.trace("saving file");
        String filename = storageService.save(file);
        return new ResponseEntity<RestResponse>(
                RestResponse.successBuild(FileDto.builder().name(filename).build()),
                HttpStatus.OK);
    }

    @RequestMapping(method = RequestMethod.GET, path = "/{filename}")
    ResponseEntity<Resource> media(@PathVariable("filename") String fileName) {
        Resource file = storageService.load(fileName);
        return ResponseEntity
                .ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, attachement + file.getFilename() + "\"")
                .contentType(MediaType.IMAGE_PNG)
                .body(file);
    }
}
