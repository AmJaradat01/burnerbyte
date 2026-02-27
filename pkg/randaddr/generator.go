package randaddr

import (
	"crypto/rand"
	"math/big"
)

const charset = "abcdefghijklmnopqrstuvwxyz0123456789"

// Generate returns a random alphanumeric lowercase string of the given length.
func Generate(length int) (string, error) {
	if length < 6 {
		length = 6
	}
	if length > 12 {
		length = 12
	}
	b := make([]byte, length)
	for i := range b {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		if err != nil {
			return "", err
		}
		b[i] = charset[n.Int64()]
	}
	return string(b), nil
}
