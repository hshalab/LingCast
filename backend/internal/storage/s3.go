package storage

import (
	"context"
	"io"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"talkingavatar/backend/internal/config"
)

// Client is a thin wrapper over the AWS SDK v2 S3 client pointed at the
// RustFS (or any S3-compatible) endpoint.
type Client struct {
	api           *s3.Client
	bucket        string
	publicBaseURL string
}

// New builds an S3 client using path-style addressing, which is required by
// RustFS / MinIO style endpoints.
func New(cfg config.Config) (*Client, error) {
	awsCfg, err := awsconfig.LoadDefaultConfig(
		context.Background(),
		awsconfig.WithRegion("us-east-1"),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			cfg.S3AccessKey, cfg.S3SecretKey, "")),
	)
	if err != nil {
		return nil, err
	}

	api := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(cfg.S3Endpoint)
		o.UsePathStyle = true
	})

	return &Client{
		api:           api,
		bucket:        cfg.S3Bucket,
		publicBaseURL: cfg.S3PublicBaseURL,
	}, nil
}

// Upload streams an object to S3 under the given key.
func (c *Client) Upload(ctx context.Context, key string, body io.Reader, contentType string) error {
	_, err := c.api.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(c.bucket),
		Key:         aws.String(key),
		Body:        body,
		ContentType: aws.String(contentType),
	})
	return err
}

// PublicURL builds a browser-reachable URL for an object. In the dockerized
// setup this goes through the nginx /media proxy so the storage service does
// not need to be exposed to the host.
func (c *Client) PublicURL(key string) string {
	if key == "" || c.publicBaseURL == "" {
		return ""
	}
	return strings.TrimRight(c.publicBaseURL, "/") + "/" + c.bucket + "/" + key
}

// Delete removes an object from S3 (best-effort for cleanup flows).
func (c *Client) Delete(ctx context.Context, key string) error {
	if key == "" {
		return nil
	}
	_, err := c.api.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(key),
	})
	return err
}
