package com.beskar.user.services.impl;

import com.beskar.user.client.UserApiClient;
import com.beskar.user.dto.UserInfoDto;
import com.beskar.user.services.UserService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * Implementation of user service.
 */
@Service
public class UserServiceImpl implements UserService {

    @Autowired
    UserApiClient userApiClient;

    @Override
    public UserInfoDto getUserInfo(String token) {
        return userApiClient.getUserInfo(token);
    }
    
}
