package com.beskar.user.services;

import com.beskar.user.dto.UserInfoDto;

/**
 * User service.
 */
public interface UserService {

    /**
     * Given a token should return user information.
     *
     * @param token along with bearer string
     * @return user information.
     */
    public UserInfoDto getUserInfo(String token); 
}
