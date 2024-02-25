package com.beskar.user.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Builder;
import lombok.Data;

/**
 * DTO for user details.
 */
@Data
@Builder
public class UserInfoDto {
    private String name;

    private String username;

    private String email;

    private String id;

    @JsonProperty("id")
    public String getId() {
        return this.id;
    }

    @JsonProperty("sub")
    public void setId(String id) {
        this.id = id;
    }


    @JsonProperty("preferred_username")
    public void setUserName(String username) {
        this.username = username;
    }
}
