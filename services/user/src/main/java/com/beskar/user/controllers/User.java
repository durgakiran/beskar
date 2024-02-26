package com.beskar.user.controllers;

import com.beskar.user.common.RestResponse;
import com.beskar.user.dto.UserInfoDto;
import com.beskar.user.services.UserService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;



/**
 * User controller.
 */
@RestController
@RequestMapping("/user")
public class User {
    private static final Logger logger = LoggerFactory.getLogger(User.class);

    @Autowired
    UserService userService;
    
    @CrossOrigin(origins = "http://localhost:3000", allowCredentials = "true")
    @RequestMapping(method = {RequestMethod.GET}, path = "/details")
    ResponseEntity<RestResponse> user(@RequestHeader("Authorization") String token) {
        logger.debug("token: {}", token);
        UserInfoDto userInfoDto = userService.getUserInfo(token);
        return new ResponseEntity<RestResponse>(
                RestResponse.successBuild(userInfoDto),
                HttpStatus.OK);
    }
}
