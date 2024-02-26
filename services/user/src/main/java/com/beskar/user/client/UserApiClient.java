package com.beskar.user.client;

import com.beskar.user.dto.UserInfoDto;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

/**
 * Client service for calling keycloak APIs.
 */
@Service
public class UserApiClient {

    private static final Logger logger = LoggerFactory.getLogger(UserApiClient.class);

    @Autowired
    RestTemplate restTemplate;

    @Value("${user.base.url}")
    private String baseUrl;

    @Value("${keycloak.realm}")
    private String realm;

    @Value("${user.info.url}")
    private String userInfoPath;

    /**
     * Get user information from keycloak service.
     *
     * @param token whole token ex: "Bearer `token`".
     * @return user information.
     */
    public UserInfoDto getUserInfo(String token) {
        logger.trace("getting user information");
        logger.debug("token: {}", token);
        HttpHeaders httpHeaders = new HttpHeaders();
        httpHeaders.set("Authorization", token);
        httpHeaders.setAccept(List.of(MediaType.APPLICATION_JSON));
        HttpEntity<String> entity = new HttpEntity<>(httpHeaders);
        String url = baseUrl + "/" + realm + "/" + userInfoPath;
        ResponseEntity<UserInfoDto> response = restTemplate.exchange(url,
                HttpMethod.GET, entity, UserInfoDto.class);
        logger.debug("user response: {}", response.getBody().toString());
        return response.getBody();
    }
}
