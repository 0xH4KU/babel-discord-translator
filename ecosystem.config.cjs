module.exports = {
    apps: [
        {
            name: 'babel',
            script: 'src/index.ts',
            interpreter: 'node',
            interpreter_args: '--import tsx',
            env: {
                NODE_ENV: 'production',
            },
            max_memory_restart: '150M',
            restart_delay: 5000,
        },
    ],
};
