module.exports = {
    apps: [
        {
            name: 'babel',
            script: 'dist/src/index.js',
            env: {
                NODE_ENV: 'production',
            },
            max_memory_restart: '250M',
            restart_delay: 5000,
        },
    ],
};
