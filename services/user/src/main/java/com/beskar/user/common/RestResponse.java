package com.beskar.user.common;

import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import com.fasterxml.jackson.databind.annotation.JsonPOJOBuilder;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import lombok.Builder;
import lombok.Data;

/**
 * Common structure for response bodies.
 */

@Builder
@Data
@JsonDeserialize(builder = RestResponse.RestResponseBuilder.class)
public class RestResponse {
    public static final boolean REPONSE_SUCCESS = true;

    public static final boolean RESPONSE_FAILURE = false;

    public static final String SUCCESS_STATUS = "success";

    public static final String FAILURE_STATUS = "failure";

    public static final EmptyJsonResponse EMPY_JSON_OBJECT = new EmptyJsonResponse();

    public static final String MSG_OPERATION_SUCCEEDED = "Operation succeeded!";

    /**
     * Represents response data.
     */
    private Object data;

    /**
     * Represents if request is successful or not.
     */
    private Boolean success;

    /**
     * Message of operation.
     */
    private String message;

    /**
     * Builds success response.
     *
     * @param data any data.
     * @return rest response.
     */
    public static RestResponse successBuild(final Object data) {
        return RestResponse.builder()
                .data(data)
                .success(REPONSE_SUCCESS)
                .message(MSG_OPERATION_SUCCEEDED)
                .build();
    }

    /**
     * Builds success response.
     *
     * @param data any data.
     * @return rest response.
     */
    public static RestResponse successBuild(final Object data, final String message) {
        return RestResponse.builder()
                .data(data)
                .success(REPONSE_SUCCESS)
                .message(message)
                .build();
    }

    /**
     * Builds failure response.
     *
     * @param message failure message.
     * @return rest response.
     */
    public static RestResponse failureBuild(final String message) {
        return RestResponse.builder()
                .data(EMPY_JSON_OBJECT)
                .success(RESPONSE_FAILURE)
                .message(message)
                .build();
    }

    /**
     * normal response build.
     *
     * @param data    respnose data.
     * @param message response message.
     * @param success is request success or failure.
     * @return response.
     */
    public static RestResponse build(
            final Object data, final String message, final boolean success) {
        return RestResponse.builder()
                .data(data)
                .success(success)
                .message(message)
                .build();
    }

    /**
     * Builder.
     */
    @JsonPOJOBuilder(withPrefix = "")
    public static class RestResponseBuilder {

    }

    /**
     * Empty json response.
     */
    @JsonDeserialize
    @JsonSerialize
    public static class EmptyJsonResponse {
    }
}
